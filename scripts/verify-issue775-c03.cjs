#!/usr/bin/env node
/* global document, HTMLElement, HTMLInputElement, HTMLButtonElement, HTMLImageElement, getComputedStyle */
/**
 * Issue #775 C03 bounded Windows Electron workbench evidence.
 *
 * The real source FLA is opened read-only. Test projects and the Electron
 * profile live under the external acceptance root. Screenshots and bounded
 * receipts are written to docs/evidence/issue-775-c03.
 */

'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue775-c03';
const DEFAULT_SOURCE_ROOT = 'D:\\表情合集\\新人物';
const SOURCE_FILE_NAME = '蓝发修仙女.fla';
const SOURCE_SHA256 = '86eb123fdd42f1dac80754c9260b793404072be70523b41d012598138c35c6d2';
const BLUEHAIR_TARGET_ID = 'fla-render-target-71289be86ab338b9c728b476f628b5708ec035560586326cc48e6af8eacfe8dd';
const BLUEHAIR_LIBRARY_ITEM = '神女-cilisucai.com/神女-cilisucai.com809';
const CATALOG_CHANNEL = 'fla:snapshot-catalog';
const PREVIEW_CHANNEL = 'fla:snapshot-preview';
const SNAPSHOT_COMMIT_CHANNEL = 'fla:snapshot-commit';
const RASTER_COMMIT_CHANNEL = 'fla:commit-selected';
const SEQUENCE_RENDER_CHANNEL = 'fla:frame-sequence-render';
const BASELINE_PATH = 'docs/evidence/issue-767-u3/run-2026-10-14T05-12-54-820Z/bluehair-com809-selected-one-before-import.png';
const BASELINE_SHA256 = 'c5bd3f4be5079a9f4e4dc1e47e6ba261c5637f84c5ae7ea3479915137460709c';
const BASELINE_RECEIPT_PATH = 'docs/evidence/issue-767-u3/run-2026-10-14T05-12-54-820Z/receipt.json';
const BASELINE_WINDOW_BOUNDS = { width: 1201, height: 761 };
const C03_WINDOW_REQUESTED_BOUNDS = { width: 1200, height: 761 };

const runtime = {
  runId: new Date().toISOString().replace(/[:.]/gu, '-'),
  repositoryRoot: resolve(__dirname, '..'),
  acceptanceRoot: null,
  runRoot: null,
  userData: null,
  projectParent: null,
  evidenceDirectory: null,
  sourcePath: null,
  sourceSha256Before: null,
  project: null,
  mainWindowId: null,
  failureStage: 'startup',
  rendererDiagnostics: [],
  catalogResponses: [],
  previews: [],
  snapshotCommits: [],
  rasterCommits: [],
  sequenceRenders: [],
  screenshots: {},
  layout: {},
  assertions: {},
  injectedPreviewFailure: null,
  failNextRasterCommit: false,
  failure: null,
  previewGateTargetId: null,
  previewGateUsed: false,
  previewGate: createGate(),
  previewErrorTargetId: null,
  previewErrorUsed: false,
  previewCallsByTarget: {},
  syntheticBlankTargetId: null,
  syntheticBlankOverlay: null,
  syntheticUnsupportedTargetId: null,
  syntheticUnsupportedOverlay: null,
  sourceCatalogCounts: null,
  snapshotCommitGate: null,
};

function createGate() {
  let release;
  let markStarted;
  const promise = new Promise((resolvePromise) => {
    release = resolvePromise;
  });
  const started = new Promise((resolvePromise) => {
    markStarted = resolvePromise;
  });
  return { promise, started, release, markStarted };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--source') args.source = argv[++index];
  }
  return args;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForPromise(promise, timeoutMs, message) {
  let timeout;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

function findSourceFile(sourceRoot, fileName) {
  const directPath = join(sourceRoot, fileName);
  if (existsSync(directPath)) return directPath;
  const normalizedName = fileName.normalize('NFC');
  const pending = [sourceRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const candidate = join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.name.normalize('NFC') === normalizedName) return candidate;
    }
  }
  throw new Error('Required real FLA sample was not found: ' + fileName);
}

async function inPage(window, callback, ...args) {
  const expression = '(' + callback.toString() + ')(...' + JSON.stringify(args) + ')';
  try {
    return await window.webContents.executeJavaScript(expression);
  } catch (error) {
    const source = callback.toString().replace(/\s+/gu, ' ').slice(0, 180);
    throw new Error('Renderer script failed at ' + runtime.failureStage + ' (' + source + ').', { cause: error });
  }
}

async function waitForPage(window, callback, args = [], timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await inPage(window, callback, ...args);
      if (result) return result;
    } catch {
      // Continue while the current React surface mounts.
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for page condition: ' + callback.toString());
}

async function click(window, selector) {
  const clicked = await inPage(window, (query) => {
    const element = document.querySelector(query);
    if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element: ' + query);
    if (('disabled' in element) && element.disabled) throw new Error('Element is disabled: ' + query);
    element.click();
    return true;
  }, selector);
  assert(clicked, 'Could not click ' + selector);
  await delay(80);
}

async function sendInputKey(window, keyCode) {
  window.show();
  window.focus();
  const focusDeadline = Date.now() + 3_000;
  while (!window.isFocused() && Date.now() < focusDeadline) await delay(25);
  assert(window.isFocused(), 'Electron verification window did not receive focus for ' + keyCode + '.');
  window.webContents.focus();
  await delay(50);
  const before = await inPage(window, () => ({
    documentFocused: document.hasFocus(),
    activeElement: document.activeElement instanceof HTMLElement
      ? {
          tagName: document.activeElement.tagName,
          ariaLabel: document.activeElement.getAttribute('aria-label'),
          className: typeof document.activeElement.className === 'string' ? document.activeElement.className : '',
        }
      : null,
  }));
  assert(before.documentFocused, 'Renderer document did not receive focus for ' + keyCode + '.');
  const rendererEventStart = await inPage(window, () => {
    window.__issue775C03KeyboardEvents ??= [];
    if (!window.__issue775C03KeyboardListenerInstalled) {
      const record = (event) => window.__issue775C03KeyboardEvents.push({
        type: event.type,
        key: event.key,
        code: event.code,
        isTrusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        targetTag: event.target instanceof HTMLElement ? event.target.tagName : null,
        targetAriaLabel: event.target instanceof HTMLElement ? event.target.getAttribute('aria-label') : null,
      });
      window.addEventListener('keydown', record, true);
      window.addEventListener('keyup', record, true);
      window.__issue775C03KeyboardListenerInstalled = true;
    }
    return window.__issue775C03KeyboardEvents.length;
  });
  const mainInputEvents = [];
  const recordMainInput = (_event, input) => {
    mainInputEvents.push({ type: input.type, key: input.key, code: input.code });
  };
  window.webContents.on('before-input-event', recordMainInput);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await delay(120);
  window.webContents.removeListener('before-input-event', recordMainInput);
  const after = await inPage(window, () => ({
    documentFocused: document.hasFocus(),
    activeElement: document.activeElement instanceof HTMLElement
      ? {
          tagName: document.activeElement.tagName,
          ariaLabel: document.activeElement.getAttribute('aria-label'),
          className: typeof document.activeElement.className === 'string' ? document.activeElement.className : '',
        }
      : null,
  }));
  const rendererEvents = await inPage(window, (start) =>
    window.__issue775C03KeyboardEvents.slice(start), rendererEventStart,
  );
  runtime.layout.keyboardDispatches ??= [];
  runtime.layout.keyboardDispatches.push({
    keyCode,
    inputMethod: 'Electron webContents.sendInputEvent',
    windowFocused: window.isFocused(),
    before,
    after,
    mainInputEvents,
    rendererEvents,
  });
}

async function setInput(window, selector, value) {
  await inPage(window, (query) => {
    const input = document.querySelector(query);
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input: ' + query);
    input.focus();
    input.select();
  }, selector);
  await window.webContents.insertText(String(value));
  await delay(120);
}

async function waitForSelector(window, selector, timeoutMs = 60_000) {
  await waitForPage(window, (query) => Boolean(document.querySelector(query)), [selector], timeoutMs);
}

function recordCatalog(response, request) {
  if (!response || response.ok !== true || !Array.isArray(response.entries)) return;
  const entries = response.entries.map((entry) => ({
    targetId: entry.target.renderTargetId,
    kind: entry.target.kind,
    userLabel: entry.target.userLabel,
    sourceLibraryItemName: entry.target.sourceLibraryItemName ?? null,
    selectedFrameIndex: entry.target.selectedFrameIndex ?? 0,
    frameCount: entry.target.frameCount,
    catalogRole: entry.catalogRole ?? null,
    previewSupported: entry.previewSupported === true,
    isBlank: entry.isBlank === true,
    unsupportedReason: entry.unsupportedReason ?? null,
  }));
  runtime.catalogResponses.push({
    sessionId: request.sessionId,
    includeAuthoredStates: request.includeAuthoredStates === true,
    omittedCandidateCount: response.omittedCandidateCount ?? 0,
    entries,
  });

  if (request.includeAuthoredStates === true && !runtime.previewGateTargetId) {
    const supported = entries.filter((entry) => entry.previewSupported && !entry.isBlank);
    runtime.previewGateTargetId = supported.find((entry) =>
      entry.targetId !== BLUEHAIR_TARGET_ID &&
      entry.targetId !== runtime.syntheticBlankTargetId &&
      entry.targetId !== runtime.syntheticUnsupportedTargetId,
    )?.targetId ?? null;
    runtime.previewErrorTargetId = supported.find((entry) =>
      entry.targetId !== BLUEHAIR_TARGET_ID &&
      entry.targetId !== runtime.previewGateTargetId &&
      entry.targetId !== runtime.syntheticBlankTargetId &&
      entry.targetId !== runtime.syntheticUnsupportedTargetId,
    )?.targetId ?? null;
  }
}

function installMainProbes() {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => {
    if (channel === CATALOG_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        let returned = response;
        if (request?.includeAuthoredStates === true && !runtime.syntheticBlankTargetId && response?.ok === true) {
          runtime.sourceCatalogCounts = {
            blankEntries: response.entries.filter((entry) => entry.isBlank).length,
            unsupportedEntries: response.entries.filter((entry) => !entry.previewSupported && !entry.isBlank).length,
          };
          const syntheticEntry = response.entries.find((entry) =>
            entry.target.renderTargetId !== BLUEHAIR_TARGET_ID &&
            entry.target.frameCount === 1 &&
            entry.previewSupported &&
            !entry.isBlank,
          );
          if (syntheticEntry) {
            runtime.syntheticBlankTargetId = syntheticEntry.target.renderTargetId;
            runtime.syntheticBlankOverlay = {
              targetId: syntheticEntry.target.renderTargetId,
              originalLabel: syntheticEntry.target.userLabel,
              syntheticLabel: 'C03 空白状态验证（合成）',
              replacesRealBlankEntry: false,
            };
            const syntheticUnsupportedEntry = response.entries.find((entry) =>
              entry.target.renderTargetId !== BLUEHAIR_TARGET_ID &&
              entry.target.renderTargetId !== runtime.syntheticBlankTargetId &&
              entry.previewSupported &&
              !entry.isBlank,
            );
            if (syntheticUnsupportedEntry) {
              runtime.syntheticUnsupportedTargetId = syntheticUnsupportedEntry.target.renderTargetId;
              runtime.syntheticUnsupportedOverlay = {
                targetId: syntheticUnsupportedEntry.target.renderTargetId,
                originalLabel: syntheticUnsupportedEntry.target.userLabel,
                syntheticLabel: 'C03 不支持状态验证（合成）',
                replacesRealUnsupportedEntry: false,
              };
            }
            returned = {
              ...response,
              entries: response.entries.map((entry) => {
                if (entry === syntheticEntry) {
                  return {
                    ...entry,
                    isBlank: true,
                    previewSupported: false,
                    unsupportedReason: '仅用于验证空白状态提示的合成候选。',
                    target: { ...entry.target, userLabel: 'C03 空白状态验证（合成）' },
                  };
                }
                if (entry.target.renderTargetId === runtime.syntheticUnsupportedTargetId) {
                  return {
                    ...entry,
                    previewSupported: false,
                    unsupportedReason: '仅用于验证不可预览状态的合成候选。',
                    target: { ...entry.target, userLabel: 'C03 不支持状态验证（合成）' },
                  };
                }
                return entry;
              }),
            };
          }
        }
        recordCatalog(returned, request ?? {});
        return returned;
      });
    }
    if (channel === PREVIEW_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const targetId = request?.target?.renderTargetId ?? null;
        if (targetId === runtime.previewGateTargetId && !runtime.previewGateUsed) {
          runtime.previewGateUsed = true;
          runtime.previewGate.markStarted();
          await runtime.previewGate.promise;
        }
        const response = await handler(event, request, ...rest);
        let returned = response;
        const targetCallCount = targetId === null
          ? 0
          : (runtime.previewCallsByTarget[targetId] = (runtime.previewCallsByTarget[targetId] ?? 0) + 1);
        if (targetId === runtime.previewErrorTargetId && targetCallCount > 1 &&
          !runtime.previewErrorUsed && response?.ok === true) {
          runtime.previewErrorUsed = true;
          returned = {
            ok: false,
            error: {
              code: 'RENDER_FAILED',
              message: '本次预览检查失败，请重试或选择其他素材。',
              requestId: request.requestId,
            },
          };
          runtime.injectedPreviewFailure = {
            targetId,
            requestId: request.requestId,
            reason: 'Bounded verifier injected one preview failure after a valid Main response.',
          };
        }
        runtime.previews.push({
          targetId,
          requestId: request?.requestId ?? null,
          selectedFrameIndex: request?.target?.selectedFrameIndex ?? 0,
          ok: returned?.ok === true,
          errorCode: returned?.ok === false ? returned.error?.code ?? null : null,
          sha256: returned?.ok === true ? returned.sha256 ?? null : null,
        });
        return returned;
      });
    }
    if (channel === SNAPSHOT_COMMIT_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const gate = runtime.snapshotCommitGate;
        if (gate) {
          runtime.snapshotCommitGate = null;
          gate.markStarted();
          await gate.promise;
        }
        const response = await handler(event, request, ...rest);
        runtime.snapshotCommits.push({
          targetId: request?.target?.renderTargetId ?? null,
          confirmedPreviewRequestId: request?.confirmedPreviewRequestId ?? null,
          ok: response?.ok === true,
          resultStatus: response?.ok === true ? response.result?.status ?? null : null,
          savedRevision: response?.ok === true ? response.savedRevision ?? null : null,
        });
        return response;
      });
    }
    if (channel === RASTER_COMMIT_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        if (runtime.failNextRasterCommit) {
          runtime.failNextRasterCommit = false;
          throw new Error('Bounded verifier injected one raster-route failure before commit.');
        }
        const response = await handler(event, request, ...rest);
        runtime.rasterCommits.push({
          selectedMediaIds: request?.selectedMediaIds ?? [],
          ok: response?.ok === true,
          statuses: response?.ok === true ? response.results.map((item) => item.status) : [],
        });
        return response;
      });
    }
    if (channel === SEQUENCE_RENDER_CHANNEL) {
      return originalHandle(channel, async (event, request, ...rest) => {
        const response = await handler(event, request, ...rest);
        runtime.sequenceRenders.push({
          requestId: request?.requestId ?? null,
          sessionId: request?.sessionId ?? null,
          range: request?.range ?? null,
          ok: response?.ok === true,
          frameCount: response?.ok === true ? response.items.length : response.error?.completedFrameCount ?? 0,
          errorCode: response?.ok === false ? response.error?.code ?? null : null,
        });
        return response;
      });
    }
    return originalHandle(channel, handler);
  };
}

async function waitForMainWindow() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find((candidate) =>
      !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect)',
        );
        if (ready) {
          runtime.mainWindowId = window.id;
          return window;
        }
      } catch {
        // Wait for the built renderer to expose its allowlisted APIs.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the production Project and FLA APIs.');
}

async function createProject(window) {
  const projectCenter = await inPage(window, (selector) => Boolean(document.querySelector(selector)),
    '[data-testid="new-project-button"]');
  if (!projectCenter) {
    await click(window, '[data-testid="compact-project-more"]');
    await waitForSelector(window, '[data-testid="menu-open-project-center"]');
    await click(window, '[data-testid="menu-open-project-center"]');
  }
  await click(window, '[data-testid="new-project-button"]');
  await waitForSelector(window, '[data-testid="new-project-dialog"]');
  const name = 'C03 ' + runtime.runId;
  await setInput(window, '[data-testid="new-project-parent-directory"]', runtime.projectParent);
  await setInput(window, '[data-testid="new-project-name"]', name);
  await waitForPage(window, (selector) => {
    const button = document.querySelector(selector);
    return Boolean(button && !button.disabled);
  }, ['[data-testid="new-project-confirm"]']);
  await click(window, '[data-testid="new-project-confirm"]');
  await waitForSelector(window, '[data-testid="editor-layout"]', 90_000);
  await click(window, '[data-activity="assets"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]');
  runtime.project = { name, root: join(runtime.projectParent, name + '.pandastage') };
}

async function openFlaWorkbench(window) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = runtime.sourcePath;
  const selector = await inPage(window, () => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    if (direct instanceof HTMLButtonElement && !direct.disabled) return '[data-testid="asset-import-fla"]';
    const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
    if (resource instanceof HTMLButtonElement && !resource.disabled) return '[data-testid="resource-asset-import-fla"]';
    return null;
  });
  assert(selector, 'The FLA import action is not available in the asset library.');
  await click(window, selector);
  await waitForSelector(window, '[data-testid="fla-c03-workbench"]', 180_000);
  await waitForPage(window, () =>
    document.querySelectorAll('[data-testid="fla-c03-candidate-grid"] .fla-c03-candidate').length > 0,
  [], 180_000);
  const snapshotCatalogDeadline = Date.now() + 180_000;
  while (!runtime.catalogResponses.some((entry) => entry.includeAuthoredStates) &&
    Date.now() < snapshotCatalogDeadline) await delay(50);
  assert(runtime.catalogResponses.some((entry) => entry.includeAuthoredStates),
    'Main did not return the static snapshot catalog to the workbench.');
  await waitForPage(window, () => Boolean(
    document.querySelector('[data-testid="fla-snapshot-target-count"]') ||
    document.querySelector('[data-testid="fla-snapshot-error"]'),
  ), [], 30_000);
  runtime.layout.snapshotRunnerDebug = await inPage(window, () => ({
    reviewSessionMounted: Boolean(document.querySelector('[data-testid="fla-review-session"]')),
    controllerSlots: [...document.querySelectorAll('.fla-c03-preview-controller-slot')].map((slot) => ({
      hidden: slot.hidden,
      firstChildTag: slot.firstElementChild?.tagName ?? null,
      firstChildTestId: slot.firstElementChild?.getAttribute('data-testid') ?? null,
    })),
    snapshotReviewMounted: Boolean(document.querySelector('[data-testid="fla-snapshot-review"]')),
    snapshotRootState: document.querySelector('[data-testid="fla-snapshot-review"]')?.getAttribute('data-preview-state') ?? '',
    snapshotError: document.querySelector('[data-testid="fla-snapshot-error"]')?.textContent?.trim() ?? '',
    snapshotEntryCount: document.querySelector('[data-testid="fla-snapshot-target-count"]')?.textContent?.trim() ?? '',
    snapshotSourceRows: document.querySelectorAll('.fla-snapshot-candidate-row').length,
    unifiedKindCounts: [...document.querySelectorAll('.fla-c03-candidate')].reduce((counts, row) => {
      const kind = row.dataset.candidateKind ?? 'missing';
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    }, {}),
    snapshotSlotHidden: document.querySelector('[data-testid="fla-snapshot-review"]')?.closest('.fla-c03-preview-controller-slot')?.hidden ?? null,
    scanProgress: document.querySelector('[data-testid="fla-snapshot-scan-progress"]')?.textContent?.trim() ?? '',
  }));
  assert(runtime.layout.snapshotRunnerDebug.snapshotReviewMounted &&
    !runtime.layout.snapshotRunnerDebug.snapshotError &&
    Number.parseInt(runtime.layout.snapshotRunnerDebug.snapshotEntryCount, 10) > 0 &&
    runtime.layout.snapshotRunnerDebug.snapshotSourceRows > 0,
  'The mounted snapshot runner did not expose its catalog rows: ' + JSON.stringify(runtime.layout.snapshotRunnerDebug));
  assert((runtime.layout.snapshotRunnerDebug.unifiedKindCounts.snapshot ?? 0) > 0,
    'The unified candidate list did not receive snapshot rows: ' + JSON.stringify(runtime.layout.snapshotRunnerDebug));
}

async function capture(window, name) {
  await delay(200);
  const image = await window.capturePage();
  const bytes = image.toPNG();
  const filePath = join(runtime.evidenceDirectory, name + '.png');
  writeFileSync(filePath, bytes);
  const size = image.getSize();
  const record = { path: filePath, width: size.width, height: size.height, sha256: sha256(bytes) };
  runtime.screenshots[name] = record;
  return record;
}

async function readCandidateFacts(window) {
  return inPage(window, () => {
    const rows = [...document.querySelectorAll('.fla-c03-candidate')];
    const checkboxes = rows.map((row) => row.querySelector('input[type="checkbox"]'));
    const grid = document.querySelector('[data-testid="fla-c03-candidate-grid"]');
    return {
      rows: rows.map((row) => ({
        kind: row.dataset.candidateKind,
        identity: row.dataset.candidateIdentity,
        status: row.dataset.previewStatus,
        selectable: row.dataset.selectable === 'true',
        checked: row.querySelector('input[type="checkbox"]')?.checked === true,
        disabled: row.querySelector('input[type="checkbox"]')?.disabled === true,
        label: row.querySelector('.fla-c03-candidate-copy strong')?.textContent?.trim() ?? '',
      })),
      selectedCount: checkboxes.filter((input) => input?.checked).length,
      eligibleCount: rows.filter((row) =>
        row.dataset.selectable === 'true' && row.querySelector('input[type="checkbox"]')?.checked !== true,
      ).length,
      rasterCount: rows.filter((row) => row.dataset.candidateKind === 'raster').length,
      grid: grid ? {
        scrollTop: grid.scrollTop,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
        view: grid.dataset.view,
      } : null,
      search: document.querySelector('[data-testid="fla-c03-search"]')?.value ?? null,
    };
  });
}

async function focusCandidate(window, kind, targetId = null, frameIndex = null) {
  const focused = await inPage(window, (wantedKind, wantedTargetId, wantedFrameIndex) => {
    for (const row of document.querySelectorAll('.fla-c03-candidate')) {
      if (row.dataset.candidateKind !== wantedKind) continue;
      let identity;
      try { identity = JSON.parse(row.dataset.candidateIdentity ?? '[]'); } catch { continue; }
      if (wantedTargetId !== null && !identity.includes(wantedTargetId)) continue;
      if (wantedFrameIndex !== null && identity[identity.length - 1] !== String(wantedFrameIndex)) continue;
      const button = row.querySelector('.fla-c03-candidate-focus');
      if (!button) return false;
      button.scrollIntoView({ block: 'nearest' });
      button.click();
      return true;
    }
    return false;
  }, kind, targetId, frameIndex);
  assert(focused, 'Unable to focus ' + kind + ' candidate ' + (targetId ?? '(first candidate)'));
  await delay(160);
}

async function toggleCandidate(window, kind, targetId = null, frameIndex = null) {
  const toggled = await inPage(window, (wantedKind, wantedTargetId, wantedFrameIndex) => {
    for (const row of document.querySelectorAll('.fla-c03-candidate')) {
      if (row.dataset.candidateKind !== wantedKind) continue;
      let identity;
      try { identity = JSON.parse(row.dataset.candidateIdentity ?? '[]'); } catch { continue; }
      if (wantedTargetId !== null && !identity.includes(wantedTargetId)) continue;
      if (wantedFrameIndex !== null && identity[identity.length - 1] !== String(wantedFrameIndex)) continue;
      const input = row.querySelector('input[type="checkbox"]');
      if (!(input instanceof HTMLInputElement) || input.disabled) return false;
      input.click();
      return true;
    }
    return false;
  }, kind, targetId, frameIndex);
  assert(toggled, 'Unable to toggle selectable ' + kind + ' candidate ' + (targetId ?? '(first candidate)'));
  await delay(160);
}

async function activateCandidateByKeyboard(window, targetId) {
  const initial = await inPage(window, (wantedTargetId) => {
    const row = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')]
      .find((candidate) => {
        try { return JSON.parse(candidate.dataset.candidateIdentity ?? '[]').includes(wantedTargetId); }
        catch { return false; }
      });
    const button = row?.querySelector('.fla-c03-candidate-focus');
    if (!(button instanceof HTMLButtonElement)) return null;
    button.focus();
    return {
      pressed: button.getAttribute('aria-pressed') === 'true',
      checked: row.querySelector('input[type="checkbox"]')?.checked === true,
    };
  }, targetId);
  assert(initial && !initial.pressed && !initial.checked,
    'Keyboard candidate probe must start from an unfocused, unchecked target.');

  await sendInputKey(window, 'Enter');
  await waitForPage(window, (wantedTargetId) => [...document.querySelectorAll(
    '.fla-c03-candidate[data-candidate-kind="snapshot"]',
  )].some((row) => {
    try {
      const identity = JSON.parse(row.dataset.candidateIdentity ?? '[]');
      return identity.includes(wantedTargetId) &&
        row.querySelector('.fla-c03-candidate-focus')?.getAttribute('aria-pressed') === 'true';
    } catch {
      return false;
    }
  }), [targetId]);
  await waitForCandidatePreview(window, targetId);
  const focused = await inPage(window, (wantedTargetId) => {
    const row = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')]
      .find((candidate) => {
        try { return JSON.parse(candidate.dataset.candidateIdentity ?? '[]').includes(wantedTargetId); }
        catch { return false; }
      });
    return {
      checked: row?.querySelector('input[type="checkbox"]')?.checked === true,
      previewTargetId: document.querySelector('[data-testid="fla-snapshot-preview-image"]')?.getAttribute('data-render-target-id') ?? null,
    };
  }, targetId);
  assert(focused.previewTargetId === targetId && !focused.checked,
    'Enter should focus and preview a candidate without selecting it.');

  await sendInputKey(window, 'Tab');
  const keyboardFocus = await inPage(window, (wantedTargetId) => {
    const row = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')]
      .find((candidate) => {
        try { return JSON.parse(candidate.dataset.candidateIdentity ?? '[]').includes(wantedTargetId); }
        catch { return false; }
      });
    const checkbox = row?.querySelector('input[type="checkbox"]');
    const hitbox = checkbox?.closest('.fla-c03-checkbox-hitbox');
    return {
      checkboxFocused: document.activeElement === checkbox,
      selectedCount: document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length,
      outlineWidth: hitbox ? Number.parseFloat(getComputedStyle(hitbox).outlineWidth) : 0,
      outlineStyle: hitbox ? getComputedStyle(hitbox).outlineStyle : 'none',
    };
  }, targetId);
  assert(keyboardFocus.checkboxFocused && keyboardFocus.selectedCount === 0 &&
    keyboardFocus.outlineWidth >= 2 && keyboardFocus.outlineStyle !== 'none',
  'Tab should reach the unchecked checkbox and show its keyboard focus ring.');

  await sendInputKey(window, 'Space');
  await waitForPage(window, (wantedTargetId) => [...document.querySelectorAll(
    '.fla-c03-candidate[data-candidate-kind="snapshot"]',
  )].some((row) => {
    try {
      const identity = JSON.parse(row.dataset.candidateIdentity ?? '[]');
      return identity.includes(wantedTargetId) && row.querySelector('input[type="checkbox"]')?.checked === true;
    } catch {
      return false;
    }
  }), [targetId]);
  return keyboardFocus;
}

async function waitForCandidatePreview(window, targetId, timeoutMs = 180_000) {
  await waitForPage(window, (wantedTargetId) => {
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 &&
      image.getAttribute('data-render-target-id') === wantedTargetId;
  }, [targetId], timeoutMs);
}

function findCatalogEntry(predicate) {
  return runtime.catalogResponses.flatMap((response) => response.entries).find(predicate) ?? null;
}

function findBluehairCatalogEntry() {
  return findCatalogEntry((entry) =>
    entry.targetId === BLUEHAIR_TARGET_ID &&
    entry.sourceLibraryItemName === BLUEHAIR_LIBRARY_ITEM &&
    entry.selectedFrameIndex === 0,
  );
}

function findLongSequenceEntry() {
  const entries = runtime.catalogResponses
    .filter((response) => response.includeAuthoredStates === false)
    .flatMap((response) => response.entries);
  return entries.find((entry) =>
    entry.frameCount >= 26 && entry.previewSupported && !entry.isBlank,
  ) ?? null;
}

async function readProjectState(projectRoot) {
  const json = readFileSync(join(projectRoot, 'project.json'), 'utf8');
  const project = JSON.parse(json);
  return {
    sha256: sha256(Buffer.from(json, 'utf8')),
    revision: project.revision ?? null,
    assets: (project.assets ?? []).map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      sha256: asset.sha256,
      flaSnapshot: asset.flaSnapshot ?? null,
    })),
  };
}

async function saveProject(window) {
  const state = await waitForPage(window, () => {
    const button = document.querySelector('[data-testid="quick-action-save"]');
    const saveState = document.querySelector('[data-testid="quick-action-drawer"]')?.getAttribute('data-save-state') ?? '';
    if (!(button instanceof HTMLButtonElement)) return null;
    if (button.disabled && ['dirty', 'saving', 'failed'].includes(saveState)) return null;
    return { disabled: button.disabled, saveState };
  }, [], 90_000);
  if (state.disabled) {
    assert(!['dirty', 'saving', 'failed'].includes(state.saveState),
      'The save action was disabled while an unsaved or failed state was active.');
    assert(!await inPage(window, () => Boolean(
      document.querySelector('[data-testid="project-save-state"]') ||
      document.querySelector('[data-testid="project-save-state-rest"]'),
    )), 'A visible save status remained after the project reported a clean state.');
    return;
  }
  await click(window, '[data-testid="quick-action-save"]');
  await waitForPage(window, () =>
    document.querySelector('[data-testid="quick-action-drawer"]')?.getAttribute('data-save-state') === 'saved' &&
    !document.querySelector('[data-testid="project-save-state"]') &&
    !document.querySelector('[data-testid="project-save-state-rest"]'),
  [], 90_000);
}

async function closeProject(window) {
  await click(window, '[data-testid="quick-action-close"]');
  await waitForSelector(window, '[data-testid="new-project-button"]', 90_000);
}

async function reopenRecentProject(window, name) {
  await waitForPage(window, (projectName) =>
    [...document.querySelectorAll('li.recent-project-card')]
      .some((card) => card.querySelector('strong')?.textContent?.trim() === projectName),
  [name], 90_000);
  const opened = await inPage(window, (projectName) => {
    const card = [...document.querySelectorAll('li.recent-project-card')]
      .find((item) => item.querySelector('strong')?.textContent?.trim() === projectName);
    const button = card?.querySelector('button[data-task4-core="recent-open"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  }, name);
  assert(opened, 'The saved C03 project was not available in Recent Projects.');
  await waitForSelector(window, '[data-testid="editor-layout"]', 90_000);
}

async function waitForPreviewGate(window) {
  await waitForSelector(window, '[data-testid="fla-c03-catalog-progress"]');
  const catalogDeadline = Date.now() + 180_000;
  while ((!runtime.previewGateTargetId || !runtime.catalogResponses.some((entry) => entry.includeAuthoredStates)) &&
    Date.now() < catalogDeadline) await delay(50);
  assert(runtime.previewGateTargetId, 'Main did not provide a supported target for the progressive-preview probe.');
  runtime.layout.progressiveTargetId = runtime.previewGateTargetId;
  if (runtime.previewGateTargetId) {
    await waitForPromise(runtime.previewGate.started, 180_000, 'Timed out waiting for progressive preview to start.');
    runtime.layout.progressText = await inPage(window, () =>
      document.querySelector('[data-testid="fla-c03-catalog-progress"]')?.textContent?.trim() ?? '',
    );
    runtime.screenshots.progressive = await capture(window, 'progressive-load');
    runtime.assertions.progressiveLoadCaptured = true;
    runtime.previewGate.release();
  } else {
    runtime.layout.progressText = await inPage(window, () =>
      document.querySelector('[data-testid="fla-c03-catalog-progress"]')?.textContent?.trim() ?? '',
    );
    runtime.assertions.progressiveLoadCaptured = false;
  }
}

async function verifySelectionAndList(window) {
  let facts = await readCandidateFacts(window);
  assert(facts.rasterCount === 336, 'Expected all 336 source bitmap candidates; found ' + facts.rasterCount + '.');
  runtime.assertions.all336BitmapsListed = true;
  runtime.assertions.bitmapListScrollable = facts.grid.scrollHeight > facts.grid.clientHeight;
  assert(runtime.assertions.bitmapListScrollable, 'The candidate list did not expose a scrollable offscreen region.');
  runtime.screenshots.bitmapHeavy = await capture(window, 'bitmap-heavy-336');

  await setInput(window, '[data-testid="fla-c03-search"]', 'c03-no-result-' + runtime.runId);
  await waitForSelector(window, '[data-testid="fla-c03-empty-state"]');
  facts = await readCandidateFacts(window);
  assert(facts.rows.length === 0, 'Search did not filter the visible candidate list.');
  runtime.screenshots.noResults = await capture(window, 'search-no-results');
  await setInput(window, '[data-testid="fla-c03-search"]', '');
  await waitForPage(window, () => document.querySelectorAll('.fla-c03-candidate').length >= 336);
  await waitForPage(window, () => [...document.querySelectorAll(
    '.fla-c03-candidate[data-candidate-kind="snapshot"]',
  )].every((row) => !['checking', 'unscanned'].includes(row.dataset.previewStatus)), [], 180_000);

  facts = await readCandidateFacts(window);
  runtime.layout.bulkScanSettled = {
    snapshotCount: facts.rows.filter((row) => row.kind === 'snapshot').length,
    progressText: await inPage(window, () =>
      document.querySelector('[data-testid="fla-c03-catalog-progress"]')?.textContent?.trim() ?? '',
    ),
  };
  const expectedEligible = facts.eligibleCount;
  assert(expectedEligible > 50, 'The source did not produce more than 50 new eligible candidates.');
  runtime.layout.bulkEligibility = {
    search: facts.search,
    expectedEligible,
    eligibleByKind: facts.rows.reduce((counts, row) => {
      if (!row.selectable || row.checked) return counts;
      counts[row.kind] = (counts[row.kind] ?? 0) + 1;
      return counts;
    }, {}),
    nonRasterRows: facts.rows.filter((row) => row.kind !== 'raster').map((row) => ({
      kind: row.kind,
      status: row.status,
      selectable: row.selectable,
      checked: row.checked,
      label: row.label,
    })),
  };
  await click(window, '[data-testid="fla-c03-select-current-results"]');
  await waitForSelector(window, '[data-testid="fla-c03-bulk-confirmation"]');
  const confirmationFacts = await inPage(window, () => {
    const rows = [...document.querySelectorAll('.fla-c03-candidate')];
    const eligibleRows = rows.filter((row) =>
      row.dataset.selectable === 'true' && row.querySelector('input[type="checkbox"]')?.checked !== true,
    );
    const confirmationText = document.querySelector('[data-testid="fla-c03-bulk-confirm"]')?.textContent?.trim() ?? '';
    return {
      confirmationText,
      confirmationCount: Number(confirmationText.match(/[0-9]+/)?.[0] ?? 0),
      eligibleCount: eligibleRows.length,
      eligibleByKind: eligibleRows.reduce((counts, row) => {
        const kind = row.dataset.candidateKind ?? 'missing';
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      }, {}),
      candidateRowCount: rows.length,
    };
  });
  const confirmationCount = confirmationFacts.confirmationCount;
  runtime.layout.bulkConfirmationCount = confirmationCount;
  runtime.layout.bulkEligibilityAtConfirmation = confirmationFacts;
  runtime.screenshots.bulkConfirmation = await capture(window, 'bulk-confirmation');
  const bulkActionFacts = await inPage(window, () => {
    const rows = [...document.querySelectorAll('.fla-c03-candidate')];
    const eligibleRows = rows.filter((row) =>
      row.dataset.selectable === 'true' && row.querySelector('input[type="checkbox"]')?.checked !== true,
    );
    const button = document.querySelector('[data-testid="fla-c03-bulk-confirm"]');
    const buttonText = button?.textContent?.trim() ?? '';
    const displayedCount = Number(buttonText.match(/[0-9]+/)?.[0] ?? 0);
    const eligibleByKind = eligibleRows.reduce((counts, row) => {
      const kind = row.dataset.candidateKind ?? 'missing';
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    }, {});
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return { buttonText, displayedCount, eligibleCount: eligibleRows.length, eligibleByKind, clicked: false };
    }
    button.click();
    return { buttonText, displayedCount, eligibleCount: eligibleRows.length, eligibleByKind, clicked: true };
  });
  runtime.layout.bulkAction = bulkActionFacts;
  runtime.layout.bulkConfirmationCountAtClick = bulkActionFacts.displayedCount;
  assert(bulkActionFacts.clicked, 'Bulk confirmation action was not available at click time.');
  assert(bulkActionFacts.displayedCount === bulkActionFacts.eligibleCount,
    `Bulk confirmation displayed ${bulkActionFacts.displayedCount} at click time for ${bulkActionFacts.eligibleCount} eligible candidates.`);
  const confirmedCount = bulkActionFacts.displayedCount;
  runtime.assertions.bulkConfirmationUsesAllOffscreenEligibleItems = true;
  let appliedFacts = await readCandidateFacts(window);
  const applyDeadline = Date.now() + 10_000;
  while (appliedFacts.selectedCount !== confirmedCount && Date.now() < applyDeadline) {
    await delay(100);
    appliedFacts = await readCandidateFacts(window);
  }
  const appliedByKind = appliedFacts.rows.reduce((counts, row) => {
    if (!row.checked) return counts;
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return counts;
  }, {});
  const remainingEligibleByKind = appliedFacts.rows.reduce((counts, row) => {
    if (!row.selectable || row.checked) return counts;
    counts[row.kind] = (counts[row.kind] ?? 0) + 1;
    return counts;
  }, {});
  runtime.layout.bulkApplied = {
    expectedCount: confirmedCount,
    selectedCount: appliedFacts.selectedCount,
    selectedByKind: appliedByKind,
    remainingEligibleByKind,
    selectedViewCount: await inPage(window, () =>
      document.querySelector('[data-testid="fla-c03-selected-view"]')?.textContent?.trim() ?? null,
    ),
  };
  assert(appliedFacts.selectedCount === confirmedCount,
    `Bulk confirmation displayed ${confirmedCount} additions but selected ${appliedFacts.selectedCount}: ${JSON.stringify(runtime.layout.bulkApplied)}.`);
  await inPage(window, () => {
    const grid = document.querySelector('[data-testid="fla-c03-candidate-grid"]');
    grid.scrollTop = grid.scrollHeight;
  });
  const scrollBefore = await inPage(window, () =>
    document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.scrollTop ?? 0,
  );
  await click(window, '[data-testid="fla-c03-selected-view"]');
  await waitForPage(window, () =>
    document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.dataset.view === 'selected',
  );
  const selectedFacts = await readCandidateFacts(window);
  assert(selectedFacts.rows.length === confirmedCount, 'Selected view dropped a checked candidate.');
  await click(window, '[data-testid="fla-c03-selected-view"]');
  await waitForPage(window, () =>
    document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.dataset.view === 'browse',
  );
  const scrollAfter = await inPage(window, () =>
    document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.scrollTop ?? 0,
  );
  assert(Math.abs(scrollAfter - scrollBefore) < 2, 'Returning to browse did not restore scroll position.');
  runtime.assertions.selectedViewKeepsGlobalChecksAndRestoresScroll = true;
  runtime.layout.selectedViewScroll = { before: scrollBefore, after: scrollAfter };
  runtime.screenshots.selectedView = await capture(window, 'selected-view');
  await click(window, '[data-testid="fla-c03-clear-selection"]');
  await waitForPage(window, () =>
    document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length === 0,
  );

  const bluehair = findBluehairCatalogEntry();
  assert(bluehair, 'The approved composed Bluehair candidate was absent from the Main catalog.');
  await focusCandidate(window, 'raster');
  runtime.layout.composedSearchTerm = bluehair.userLabel;
  await setInput(window, '[data-testid="fla-c03-search"]', bluehair.userLabel);
  runtime.layout.composedSearchFacts = await inPage(window, () => ({
    query: document.querySelector('[data-testid="fla-c03-search"]')?.value ?? '',
    selectedOnly: document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.dataset.view === 'selected',
    rows: [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')].map((row) => ({
      label: row.querySelector('.fla-c03-candidate-copy strong')?.textContent?.trim() ?? '',
      identity: row.dataset.candidateIdentity ?? '',
    })),
  }));
  runtime.screenshots.composedSearch = await capture(window, 'composed-candidate-search');
  await waitForPage(window, (targetId) => {
    for (const row of document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')) {
      let identity;
      try { identity = JSON.parse(row.dataset.candidateIdentity ?? '[]'); } catch { continue; }
      if (identity.includes(targetId)) return true;
    }
    return false;
  }, [bluehair.targetId]);
  const keyboardFocus = await activateCandidateByKeyboard(window, bluehair.targetId);
  facts = await readCandidateFacts(window);
  assert(facts.selectedCount === 1, 'Space did not select the focused candidate after the independent focus check.');
  runtime.assertions.thumbnailFocusDoesNotSelect = true;
  runtime.assertions.keyboardEnterTabSpaceWorks = true;
  runtime.layout.keyboardFocus = keyboardFocus;
  runtime.screenshots.keyboardFocus = await capture(window, 'keyboard-focus-and-selection');
  runtime.screenshots.composedPreview = await capture(window, 'composed-character-preview');
  await setInput(window, '[data-testid="fla-c03-search"]', 'c03-no-result-' + runtime.runId);
  await waitForSelector(window, '[data-testid="fla-c03-empty-state"]');
  await click(window, '[data-testid="fla-c03-selected-view"]');
  facts = await readCandidateFacts(window);
  assert(facts.rows.length === 1 && facts.rows[0].kind === 'snapshot' && facts.rows[0].checked,
    'Selected view applied the active search filter.');
  runtime.assertions.selectedViewIgnoresSearch = true;
  runtime.screenshots.selectedViewIgnoresSearch = await capture(window, 'selected-view-ignores-search');
  await click(window, '[data-testid="fla-c03-selected-view"]');
  await click(window, '[data-testid="fla-c03-clear-selection"]');
  await setInput(window, '[data-testid="fla-c03-search"]', '');
  await waitForPage(window, () => document.querySelectorAll('.fla-c03-candidate').length >= 336);

  assert(runtime.syntheticBlankTargetId, 'No safe real catalog target was available for the synthetic blank-state probe.');
  const blankState = await focusPreviewStatus(window, 'blank');
  assert(blankState.label.includes('空白状态验证（合成）'), 'Synthetic blank-state probe was not visibly labeled.');
  runtime.assertions.syntheticBlankStateCaptured = true;
  runtime.screenshots.syntheticBlankState = await capture(window, 'synthetic-blank-state');

  assert(runtime.sourceCatalogCounts &&
    (runtime.sourceCatalogCounts.unsupportedEntries > 0 || runtime.syntheticUnsupportedTargetId),
  'Neither the real FLA catalog nor the transparent synthetic probe provided an unsupported candidate.');
  await focusPreviewStatus(window, 'unsupported');
  runtime.assertions.unsupportedStateCaptured = true;
  runtime.screenshots.unsupportedState = await capture(window, 'unsupported-preview-state');

  if (runtime.previewErrorTargetId) {
    await focusCandidate(window, 'snapshot', runtime.previewErrorTargetId);
    await waitForPage(window, (targetId) => [...document.querySelectorAll(
      '.fla-c03-candidate[data-candidate-kind="snapshot"][data-preview-status="error"]',
    )].some((row) => {
      try { return JSON.parse(row.dataset.candidateIdentity ?? '[]').includes(targetId); }
      catch { return false; }
    }), [runtime.previewErrorTargetId], 180_000);
    assert(runtime.previewErrorUsed, 'The focused-preview failure probe did not inject its bounded failure.');
    const errorFacts = await readCandidateFacts(window);
    const failed = errorFacts.rows.find((row) => row.status === 'error');
    assert(failed && !failed.selectable && failed.disabled, 'A failed preview remained selectable.');
    runtime.assertions.failedPreviewUnavailable = true;
    runtime.screenshots.failedPreview = await capture(window, 'failed-preview');
  } else {
    runtime.assertions.failedPreviewUnavailable = false;
  }

  runtime.layout.blankCandidateCount = findBlankEntries().length;
  runtime.layout.unsupportedCandidateCount = findUnsupportedEntries().length;
}

function findBlankEntries() {
  return runtime.catalogResponses.flatMap((response) => response.entries).filter((entry) => entry.isBlank);
}

function findUnsupportedEntries() {
  return runtime.catalogResponses.flatMap((response) => response.entries)
    .filter((entry) => !entry.previewSupported && !entry.isBlank);
}

async function focusPreviewStatus(window, status) {
  const focused = await inPage(window, (wantedStatus) => {
    const row = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')]
      .find((candidate) => candidate.dataset.previewStatus === wantedStatus);
    const button = row?.querySelector('.fla-c03-candidate-focus');
    if (!(button instanceof HTMLButtonElement)) return null;
    button.scrollIntoView({ block: 'nearest' });
    button.click();
    return {
      label: row.querySelector('.fla-c03-candidate-copy strong')?.textContent?.trim() ?? '',
      identity: row.dataset.candidateIdentity ?? '',
      selectable: row.dataset.selectable === 'true',
      disabled: row.querySelector('input[type="checkbox"]')?.disabled === true,
    };
  }, status);
  assert(focused, 'No snapshot candidate exposes the ' + status + ' state.');
  assert(!focused.selectable && focused.disabled,
    'The ' + status + ' candidate was not visibly excluded from selection.');
  await waitForPage(window, (wantedStatus) =>
    document.querySelector('[data-testid="fla-c03-preview"]')?.dataset.previewStatus === wantedStatus,
  [status], 180_000);
  await delay(150);
  return focused;
}

async function renderSequenceRange(window, target, startOneBased, expectedCount, screenshotName) {
  await setInput(window, '[data-testid="fla-frame-sequence-start"]', String(startOneBased));
  const startIndex = startOneBased - 1;
  const endIndex = Math.min(target.frameCount - 1, startIndex + 23);
  await waitForPage(window, (expectedStart, expectedEnd, expectedUiStart) => {
    const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
    const input = document.querySelector('[data-testid="fla-frame-sequence-start"]');
    return range?.dataset.rangeStart === expectedStart && range?.dataset.rangeEnd === expectedEnd &&
      input?.value === expectedUiStart;
  }, [String(startIndex), String(endIndex), String(startOneBased)]);
  const beforeCount = runtime.sequenceRenders.length;
  await click(window, '[data-testid="fla-frame-sequence-render"]');
  await waitForPage(window, (expected) =>
    document.querySelectorAll('[data-testid="fla-frame-sequence-filmstrip"] [data-frame-index]').length === expected &&
    document.querySelector('[data-testid="fla-frame-sequence-preview-status"]')?.dataset.previewState === 'valid',
  [expectedCount], 300_000);
  assert(runtime.sequenceRenders.length === beforeCount + 1, 'Sequence generation did not make exactly one Main request.');
  const request = runtime.sequenceRenders.at(-1);
  assert(request.ok && request.range.startFrameIndex === startIndex && request.range.endFrameIndex === endIndex,
    'Main sequence request did not match the user-facing range.');
  runtime.screenshots[screenshotName] = await capture(window, screenshotName);
  return request;
}

async function verifySequence(window) {
  const target = findLongSequenceEntry();
  assert(target, 'No supported real target with at least 26 frames was available for range evidence.');
  await focusCandidate(window, 'sequence', target.targetId);
  await waitForSelector(window, '[data-testid="fla-frame-sequence-range"]');
  const initial = await inPage(window, () => ({
    start: document.querySelector('[data-testid="fla-frame-sequence-start"]')?.value ?? null,
    preview: Boolean(document.querySelector('[data-testid="fla-frame-sequence-preview-image"]')),
  }));
  assert(initial.start === '1' && runtime.sequenceRenders.length === 0 && !initial.preview,
    'Focusing a sequence did not start at frame 1 without rendering.');
  runtime.assertions.sequenceFocusDoesNotRender = true;
  const firstCount = Math.min(target.frameCount, 24);
  const first = await renderSequenceRange(window, target, 1, firstCount, 'sequence-start-1');
  assert(first.range.endFrameIndex - first.range.startFrameIndex + 1 === 24,
    'A sequence range starting at frame 1 did not reach the 24-frame cap.');
  runtime.assertions.sequenceStartsAtOneAndCapsAt24 = true;

  await toggleCandidate(window, 'sequence', target.targetId);
  await setInput(window, '[data-testid="fla-frame-sequence-start"]', '25');
  await waitForPage(window, () =>
    document.querySelector('[data-testid="fla-frame-sequence-range"]')?.dataset.rangeStart === '24' &&
    document.querySelector('.fla-c03-candidate[data-candidate-kind="sequence"] input')?.checked !== true,
  );
  const selectedAfterRangeChange = await readCandidateFacts(window);
  assert(selectedAfterRangeChange.selectedCount === 0, 'Changing range retained a checked stale sequence.');
  runtime.assertions.sequenceRangeChangeInvalidatesCheck = true;
  const secondCount = Math.min(target.frameCount, 48) - 24;
  assert(secondCount > 0 && secondCount <= 24, 'The target cannot produce a legal segment starting at frame 25.');
  const second = await renderSequenceRange(window, target, 25, secondCount, 'sequence-start-25');

  const nearEndStart = Math.max(1, target.frameCount - 2);
  const nearEndCount = target.frameCount - nearEndStart + 1;
  const nearEnd = await renderSequenceRange(window, target, nearEndStart, nearEndCount, 'sequence-near-end');
  assert(nearEndCount > 0 && nearEndCount < 24, 'Near-end rendering did not produce a short final segment.');
  runtime.assertions.sequenceNearEndUsesShortRemainder = true;
  runtime.layout.sequenceTarget = {
    targetId: target.targetId,
    frameCount: target.frameCount,
    requests: [first, second, nearEnd].map((request) => request.range),
  };

  await toggleCandidate(window, 'sequence', target.targetId);
  const alternate = findCatalogEntry((entry) =>
    entry.targetId !== target.targetId && entry.previewSupported && !entry.isBlank && entry.selectedFrameIndex === 0,
  );
  assert(alternate, 'Could not find a different previewable candidate for sequence invalidation.');
  await focusCandidate(window, 'snapshot', alternate.targetId, 0);
  await waitForCandidatePreview(window, alternate.targetId);
  const selected = await readCandidateFacts(window);
  assert(selected.selectedCount === 0, 'Changing target retained the checked sequence.');
  runtime.assertions.sequenceTargetChangeInvalidatesCheck = true;
}

async function verifyResponsiveAndTouch(window) {
  const bounds = window.getBounds();
  runtime.layout.windowBounds = bounds;
  const contentBounds = window.getContentBounds();
  runtime.layout.contentBounds = contentBounds;
  runtime.layout.displayScaleFactor = screen.getDisplayMatching(bounds).scaleFactor;
  runtime.layout.baselineContentBoundsInferred = {
    width: runtime.layout.baselineWidth / runtime.layout.displayScaleFactor,
    height: runtime.layout.baselineHeight / runtime.layout.displayScaleFactor,
  };
  runtime.assertions.sameContentBoundsAsBaseline = Number.isInteger(runtime.layout.baselineContentBoundsInferred.width) &&
    Number.isInteger(runtime.layout.baselineContentBoundsInferred.height) &&
    contentBounds.width === runtime.layout.baselineContentBoundsInferred.width &&
    contentBounds.height === runtime.layout.baselineContentBoundsInferred.height;
  assert(runtime.assertions.sameContentBoundsAsBaseline,
    'Before/after screenshots did not use the same logical workbench content bounds.');
  runtime.assertions.supportedWindowsScale = [1.25, 1.5].some((scale) =>
    Math.abs(runtime.layout.displayScaleFactor - scale) < 0.01,
  );
  assert(runtime.assertions.supportedWindowsScale,
    'The host display is not configured at the required 125% or 150% Windows scale.');
  runtime.layout.displays = screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
    scaleFactor: display.scaleFactor,
    size: display.size,
  }));
  runtime.layout.viewport = await inPage(window, () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }));
  const hitboxes = await inPage(window, () => {
    const selectors = [
      '.fla-c03-header button',
      '.fla-c03-browser-tools button',
      '.fla-c03-zoom-tools button',
      '.fla-c03-footer-actions button',
      '.fla-c03-checkbox-hitbox',
    ];
    return selectors.map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return { selector, width: rect?.width ?? 0, height: rect?.height ?? 0 };
    });
  });
  runtime.layout.touchHitboxes = hitboxes;
  runtime.assertions.touchTargetsAtLeast44CssPixels = hitboxes.every((item) => item.width >= 44 && item.height >= 44);
  assert(runtime.assertions.touchTargetsAtLeast44CssPixels, 'A primary touch target is smaller than 44 CSS pixels.');

  const normal = await capture(window, 'c03-normal');
  runtime.assertions.sameSizeBeforeAfter = normal.width === runtime.layout.baselineWidth &&
    normal.height === runtime.layout.baselineHeight;
  assert(runtime.assertions.sameSizeBeforeAfter, 'Before/after screenshot pixel dimensions do not match.');

  window.setBounds({ x: bounds.x, y: bounds.y, width: 860, height: 690 });
  await delay(500);
  const narrow = await inPage(window, () => {
    const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
    const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
    const columns = workbench ? getComputedStyle(workbench).gridTemplateColumns.trim().split(/\s+/u).length : 0;
    const rect = footer?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      columns,
      footerVisible: Boolean(rect && rect.height > 0 && rect.top < window.innerHeight && rect.bottom <= window.innerHeight + 1),
    };
  });
  runtime.layout.narrow = narrow;
  assert(narrow.width <= 900 && narrow.columns === 1 && narrow.footerVisible,
    'Narrow layout did not stack the workbench or keep the footer visible.');
  runtime.assertions.narrowLayoutKeepsFooterVisible = true;
  runtime.screenshots.narrow = await capture(window, 'c03-narrow');
  window.setBounds(bounds);
  await delay(300);
}

async function readImportReceipt(window) {
  return inPage(window, () => {
    const root = document.querySelector('[data-testid="fla-unified-import-receipt"]');
    const list = document.querySelector('[data-testid="fla-unified-import-items"]');
    const items = [...(list?.querySelectorAll('li') ?? [])].map((item) => ({
      kind: item.dataset.kind,
      status: item.dataset.status,
      label: item.querySelector('strong')?.textContent?.trim() ?? '',
    }));
    return {
      partial: root?.dataset.partial === 'true',
      cancelled: Boolean(document.querySelector('[data-testid="fla-unified-import-cancelled"]')),
      items,
      text: root?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    };
  });
}

async function findRasterIds(window) {
  return inPage(window, () => [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="raster"]')]
    .filter((row) => row.dataset.selectable === 'true')
    .map((row) => {
      try {
        const identity = JSON.parse(row.dataset.candidateIdentity ?? '[]');
        return { id: identity[identity.length - 1], label: row.querySelector('.fla-c03-candidate-copy strong')?.textContent?.trim() ?? '' };
      } catch {
        return null;
      }
    })
    .filter(Boolean));
}

async function verifyImportsAndPersistence(window, bluehair) {
  runtime.failureStage = 'initial-mixed-import';
  await focusCandidate(window, 'snapshot', bluehair.targetId, 0);
  await waitForCandidatePreview(window, bluehair.targetId);
  const rasterIds = await findRasterIds(window);
  assert(rasterIds.length >= 3, 'At least three raw bitmap candidates are required for bounded mixed-import evidence.');

  await toggleCandidate(window, 'snapshot', bluehair.targetId, 0);
  await toggleCandidate(window, 'raster', rasterIds[0].id);
  let facts = await readCandidateFacts(window);
  assert(facts.selectedCount === 2, 'Composition and bitmap did not remain independently checked.');

  const gate = createGate();
  runtime.snapshotCommitGate = gate;
  await click(window, '[data-testid="fla-unified-import"]');
  await waitForPromise(gate.started, 120_000, 'Timed out waiting for the in-progress snapshot commit.');
  const pending = await inPage(window, () => ({
    closeDisabled: document.querySelector('[data-testid="fla-review-cancel"]')?.disabled ?? false,
    stopButton: Boolean(document.querySelector('[data-testid="fla-unified-import-stop"]')),
    countText: document.querySelector('[data-testid="fla-unified-import-selected-count"]')?.textContent?.trim() ?? '',
  }));
  assert(pending.closeDisabled && pending.stopButton, 'Close protection or stop-after-current was missing during commit.');
  await sendInputKey(window, 'Escape');
  await waitForSelector(window, '[data-testid="fla-c03-workbench"]');
  runtime.assertions.closeAndEscapeBlockedDuringCommit = true;
  runtime.layout.importInProgress = pending;
  runtime.screenshots.importInProgress = await capture(window, 'import-in-progress');
  gate.release();
  await waitForPage(window, () =>
    Boolean(document.querySelector('[data-testid="fla-unified-import-receipt"]')) &&
    !document.querySelector('[data-testid="fla-unified-import-stop"]'),
  [], 180_000);
  const successReceipt = await readImportReceipt(window);
  assert(!successReceipt.partial && successReceipt.items.length === 2 &&
    successReceipt.items.every((item) => item.status === 'imported'),
  'Mixed composition and bitmap did not produce two successful receipt items.');
  runtime.assertions.mixedImportSuccessReceipt = true;
  runtime.screenshots.successReceipt = await capture(window, 'mixed-import-success');
  facts = await readCandidateFacts(window);
  assert(facts.selectedCount === 0, 'Terminal import did not clear the checked set.');
  assert(await inPage(window, () => Boolean(document.querySelector('[data-testid="fla-unified-import-receipt"]'))),
    'The terminal receipt did not remain visible after selection cleared.');
  runtime.assertions.terminalImportClearsChecksKeepsReceipt = true;

  runtime.failureStage = 'close-completed-session';
  const completedSessionId = runtime.catalogResponses.at(-1)?.sessionId ?? null;
  await click(window, '[data-testid="fla-review-cancel"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]');
  runtime.failureStage = 'open-fresh-session';
  await openFlaWorkbench(window);
  runtime.failureStage = 'wait-fresh-catalog-scan';
  await waitForPage(window, () => {
    const progress = document.querySelector('[data-testid="fla-c03-catalog-progress"]');
    const text = progress?.textContent?.trim() ?? '';
    return Boolean(text && !text.startsWith('正在'));
  }, [], 180_000);
  const reopenedCatalog = runtime.catalogResponses.filter((entry) => entry.includeAuthoredStates).at(-1);
  assert(reopenedCatalog?.sessionId && reopenedCatalog.sessionId !== completedSessionId,
    'A second import scenario did not start a fresh read-only FLA session.');
  runtime.assertions.repeatImportUsesFreshSession = true;
  const reopenedBluehair = findBluehairCatalogEntry();
  assert(reopenedBluehair, 'The approved composed candidate was absent from the refreshed catalog.');
  runtime.failureStage = 'read-fresh-session-candidate-state';
  const reopenedFacts = await readCandidateFacts(window);
  runtime.layout.reopenedBluehairCandidates = reopenedFacts.rows.filter((row) =>
    row.identity?.includes(reopenedBluehair.targetId),
  );
  await capture(window, 'reopened-workbench');
  runtime.failureStage = 'focus-fresh-session-candidate';
  await focusCandidate(window, 'snapshot', reopenedBluehair.targetId, 0);
  runtime.failureStage = 'wait-fresh-session-preview';
  await waitForCandidatePreview(window, reopenedBluehair.targetId);

  runtime.failureStage = 'select-duplicate-snapshot';
  await toggleCandidate(window, 'snapshot', reopenedBluehair.targetId, 0);
  runtime.failureStage = 'select-following-raster';
  await toggleCandidate(window, 'raster', rasterIds[1].id);
  const duplicateSelection = await readCandidateFacts(window);
  runtime.layout.duplicateSelection = {
    selectedCount: duplicateSelection.selectedCount,
    selected: duplicateSelection.rows.filter((row) => row.checked),
    importDisabled: await inPage(window, () =>
      document.querySelector('[data-testid="fla-unified-import"]')?.disabled ?? true,
    ),
  };
  const beforeDuplicate = await readProjectState(runtime.project.root);
  const cancelGate = createGate();
  runtime.snapshotCommitGate = cancelGate;
  runtime.failureStage = 'click-duplicate-import';
  await click(window, '[data-testid="fla-unified-import"]');
  await waitForPromise(cancelGate.started, 120_000, 'Timed out waiting for duplicate commit in stop-after-current scenario.');
  await click(window, '[data-testid="fla-unified-import-stop"]');
  cancelGate.release();
  await waitForPage(window, () =>
    Boolean(document.querySelector('[data-testid="fla-unified-import-receipt"]')) &&
    !document.querySelector('[data-testid="fla-unified-import-stop"]'),
  [], 180_000);
  const cancelledReceipt = await readImportReceipt(window);
  assert(cancelledReceipt.partial && cancelledReceipt.cancelled &&
    cancelledReceipt.items.some((item) => item.status === 'duplicate') &&
    cancelledReceipt.items.some((item) => item.status === 'not-attempted'),
  'Stop-after-current did not report the completed duplicate and unattempted next route.');
  runtime.assertions.stopAfterCurrentReceipt = true;
  runtime.assertions.duplicateImportIsNoOp =
    (await readProjectState(runtime.project.root)).sha256 === beforeDuplicate.sha256;
  assert(runtime.assertions.duplicateImportIsNoOp, 'Duplicate import changed project data or revision.');
  runtime.screenshots.cancelledReceipt = await capture(window, 'stop-after-current-receipt');

  const alternateSnapshot = findCatalogEntry((entry) =>
    entry.previewSupported && !entry.isBlank &&
    entry.targetId !== BLUEHAIR_TARGET_ID &&
    entry.targetId !== runtime.previewErrorTargetId &&
    entry.selectedFrameIndex === 0,
  );
  assert(alternateSnapshot, 'No second supported snapshot candidate was available for partial failure evidence.');
  await focusCandidate(window, 'snapshot', alternateSnapshot.targetId, 0);
  await waitForCandidatePreview(window, alternateSnapshot.targetId);
  await toggleCandidate(window, 'snapshot', alternateSnapshot.targetId, 0);
  await toggleCandidate(window, 'raster', rasterIds[2].id);
  const projectBeforeFailure = await readProjectState(runtime.project.root);
  runtime.failNextRasterCommit = true;
  await click(window, '[data-testid="fla-unified-import"]');
  await waitForPage(window, () =>
    Boolean(document.querySelector('[data-testid="fla-unified-import-receipt"]')) &&
    !document.querySelector('[data-testid="fla-unified-import-stop"]'),
  [], 180_000);
  const partialFailure = await readImportReceipt(window);
  assert(partialFailure.partial &&
    partialFailure.items.some((item) => item.kind === 'snapshot' && item.status === 'imported') &&
    partialFailure.items.some((item) => item.kind === 'raster' && item.status === 'failed'),
  'Partial route failure did not preserve the first commit and report the later failure.');
  runtime.assertions.partialFailureRetainsFirstCommit = true;
  runtime.screenshots.partialFailureReceipt = await capture(window, 'partial-failure-receipt');
  const projectAfterFailure = await readProjectState(runtime.project.root);
  assert(projectAfterFailure.assets.length === projectBeforeFailure.assets.length + 1,
    'Later raster failure rolled back the earlier snapshot commit.');

  runtime.failureStage = 'close-review-after-partial-import';
  await click(window, '[data-testid="fla-review-cancel"]');
  await waitForSelector(window, '[data-testid="asset-browser-view"]');
  runtime.failureStage = 'save-project';
  await saveProject(window);
  const savedProject = await readProjectState(runtime.project.root);
  runtime.failureStage = 'close-project';
  await closeProject(window);
  runtime.failureStage = 'reopen-saved-project';
  await reopenRecentProject(window, runtime.project.name);
  const reopenedProject = await readProjectState(runtime.project.root);
  assert(reopenedProject.sha256 === savedProject.sha256 && reopenedProject.assets.length >= 3,
    'Mixed FLA assets did not persist after save and reopen.');
  runtime.assertions.mixedAssetsPersistAfterReopen = true;
  runtime.layout.reopenedProject = reopenedProject;
}

async function writeReceipt(status, extra = {}) {
  const sourceSha256After = runtime.sourcePath ? sha256File(runtime.sourcePath) : null;
  const primaryDisplay = screen.getPrimaryDisplay();
  const receipt = {
    schemaVersion: 'issue775-c03-windows-electron/1',
    status,
    runId: runtime.runId,
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
    runtime: {
      platform: process.platform,
      release: require('node:os').release(),
      architecture: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      processId: process.pid,
      primaryDisplayScaleFactor: primaryDisplay.scaleFactor,
      forceDeviceScaleFactor: app.commandLine.getSwitchValue('force-device-scale-factor') || null,
    },
    acceptanceRoot: runtime.runRoot,
    evidenceDirectory: runtime.evidenceDirectory,
    source: runtime.sourcePath ? {
      path: runtime.sourcePath,
      sizeBytes: readFileSync(runtime.sourcePath).byteLength,
      sha256Before: runtime.sourceSha256Before,
      sha256After: sourceSha256After,
      unchanged: runtime.sourceSha256Before === sourceSha256After,
    } : null,
    sourceCatalogCounts: runtime.sourceCatalogCounts,
    syntheticBlankOverlay: runtime.syntheticBlankOverlay,
    syntheticUnsupportedOverlay: runtime.syntheticUnsupportedOverlay,
    project: runtime.project,
    baseline: {
      path: join(runtime.repositoryRoot, BASELINE_PATH),
      receiptPath: join(runtime.repositoryRoot, BASELINE_RECEIPT_PATH),
      width: runtime.layout.baselineWidth ?? null,
      height: runtime.layout.baselineHeight ?? null,
      windowBounds: BASELINE_WINDOW_BOUNDS,
      sha256: BASELINE_SHA256,
      windowsScalingRecordedInOriginalReceipt: false,
      inferredContentBounds: runtime.layout.baselineContentBoundsInferred ?? null,
      sameContentBoundsAsC03: runtime.assertions.sameContentBoundsAsBaseline === true,
      sameCaptureSizeAsC03: Boolean(runtime.screenshots.normal &&
        runtime.screenshots.normal.width === runtime.layout.baselineWidth &&
        runtime.screenshots.normal.height === runtime.layout.baselineHeight),
    },
    layout: runtime.layout,
    screenshots: runtime.screenshots,
    catalogs: runtime.catalogResponses,
    previews: runtime.previews,
    sequenceRenders: runtime.sequenceRenders,
    snapshotCommits: runtime.snapshotCommits,
    rasterCommits: runtime.rasterCommits,
    injectedPreviewFailure: runtime.injectedPreviewFailure,
    executionDiagnostics: {
      failureStage: runtime.failureStage,
      renderer: runtime.rendererDiagnostics,
    },
    assertions: runtime.assertions,
    originalSourceUnchanged: runtime.sourceSha256Before === sourceSha256After,
    limitations: [
      'Automated Windows Electron evidence is not owner human visual acceptance.',
      'The historical before screenshot has matching pixel dimensions; its receipt did not record the Windows display scale factor.',
      'The historical before receipt records the main-window bounds but not its display scale factor; the C03 comparison matches logical content bounds and capture pixels, while current Windows scaling is recorded directly.',
      '125% Windows scaling is reported only when the host exposes a display at that scale; a Chromium forced scale factor is not described as Windows DPI.',
    ],
    ...extra,
  };
  const json = JSON.stringify(receipt, null, 2) + '\n';
  writeFileSync(join(runtime.runRoot, 'issue775-c03-receipt.json'), json, 'utf8');
  writeFileSync(join(runtime.evidenceDirectory, 'receipt.json'), json, 'utf8');
  process.stdout.write(JSON.stringify({
    status,
    receiptPath: join(runtime.runRoot, 'issue775-c03-receipt.json'),
    repoReceiptPath: join(runtime.evidenceDirectory, 'receipt.json'),
  }) + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  runtime.acceptanceRoot = resolve(args.acceptanceRoot ?? DEFAULT_ACCEPTANCE_ROOT);
  runtime.runRoot = join(runtime.acceptanceRoot, 'run-' + runtime.runId);
  runtime.userData = join(runtime.runRoot, 'electron-user-data');
  runtime.projectParent = join(runtime.acceptanceRoot, 'projects');
  runtime.evidenceDirectory = join(runtime.repositoryRoot, 'docs', 'evidence', 'issue-775-c03', 'run-' + runtime.runId);
  runtime.sourcePath = args.source ? resolve(args.source) : findSourceFile(DEFAULT_SOURCE_ROOT, SOURCE_FILE_NAME);
  for (const directory of [runtime.runRoot, runtime.userData, runtime.projectParent, runtime.evidenceDirectory]) {
    mkdirSync(directory, { recursive: true });
  }

  const baselinePath = join(runtime.repositoryRoot, BASELINE_PATH);
  assert(existsSync(baselinePath), 'The approved C02 baseline screenshot is missing.');
  const baselineBytes = readFileSync(baselinePath);
  assert(sha256(baselineBytes) === BASELINE_SHA256, 'The historical C02 baseline screenshot changed unexpectedly.');
  runtime.layout.baselineWidth = baselineBytes.readUInt32BE(16);
  runtime.layout.baselineHeight = baselineBytes.readUInt32BE(20);
  runtime.sourceSha256Before = sha256File(runtime.sourcePath);
  assert(runtime.sourceSha256Before === SOURCE_SHA256, 'The Bluehair source SHA does not match the owner-approved FLA.');
  const baselineReceipt = JSON.parse(readFileSync(join(runtime.repositoryRoot, BASELINE_RECEIPT_PATH), 'utf8'));
  const baselineMainWindow = baselineReceipt.finalWindows?.find((entry) => entry.main === true);
  assert(baselineMainWindow?.width === BASELINE_WINDOW_BOUNDS.width &&
    baselineMainWindow?.height === BASELINE_WINDOW_BOUNDS.height,
  'The approved before receipt no longer matches its recorded main-window bounds.');
  runtime.layout.baselineWindowBounds = {
    width: baselineMainWindow.width,
    height: baselineMainWindow.height,
  };

  app.setPath('userData', runtime.userData);
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  installMainProbes();
  process.env.VITE_DEV_SERVER_URL = '';
  require(join(runtime.repositoryRoot, 'dist-electron', 'main', 'index.js'));
  const window = await waitForMainWindow();
  window.webContents.on('console-message', (_event, ...args) => {
    const [first, second, third, fourth] = args;
    const details = first && typeof first === 'object'
      ? first
      : { level: first, message: second, line: third, sourceId: fourth };
    if (runtime.rendererDiagnostics.length < 80) {
      runtime.rendererDiagnostics.push({
        type: 'console',
        level: details.level ?? null,
        message: String(details.message ?? '').slice(0, 600),
        line: details.line ?? null,
        sourceId: details.sourceId ?? null,
      });
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    runtime.rendererDiagnostics.push({ type: 'render-process-gone', reason: details.reason, exitCode: details.exitCode });
  });
  runtime.failureStage = 'create-project';
  window.setBounds({ x: 30, y: 30, ...C03_WINDOW_REQUESTED_BOUNDS });
  runtime.layout.initialWindowBounds = window.getBounds();
  runtime.layout.initialContentBounds = window.getContentBounds();
  await waitForSelector(window, '[data-testid="new-project-button"]');
  await createProject(window);
  await openFlaWorkbench(window);
  await waitForPreviewGate(window);
  const catalogDeadline = Date.now() + 180_000;
  while (runtime.catalogResponses.length === 0 && Date.now() < catalogDeadline) await delay(100);
  assert(runtime.catalogResponses.length > 0, 'Main did not return a render-target catalog.');

  const bluehair = findBluehairCatalogEntry();
  assert(bluehair, 'The approved composed Bluehair candidate was absent from Main catalog.');
  await verifySelectionAndList(window);
  await focusCandidate(window, 'snapshot', bluehair.targetId, 0);
  await waitForCandidatePreview(window, bluehair.targetId);
  await verifyResponsiveAndTouch(window);
  await verifySequence(window);
  await verifyImportsAndPersistence(window, bluehair);

  const sourceSha256After = sha256File(runtime.sourcePath);
  assert(sourceSha256After === runtime.sourceSha256Before, 'The original FLA changed during browse and import.');
  runtime.assertions.originalFlaUnchanged = true;
  runtime.layout.blankCandidateCount = findBlankEntries().length;
  runtime.layout.unsupportedCandidateCount = findUnsupportedEntries().length;
  const requiredAssertions = [
    'all336BitmapsListed',
    'bitmapListScrollable',
    'bulkConfirmationUsesAllOffscreenEligibleItems',
    'selectedViewKeepsGlobalChecksAndRestoresScroll',
    'thumbnailFocusDoesNotSelect',
    'keyboardEnterTabSpaceWorks',
    'selectedViewIgnoresSearch',
    'syntheticBlankStateCaptured',
    'unsupportedStateCaptured',
    'failedPreviewUnavailable',
    'sequenceFocusDoesNotRender',
    'sequenceStartsAtOneAndCapsAt24',
    'sequenceRangeChangeInvalidatesCheck',
    'sequenceNearEndUsesShortRemainder',
    'sequenceTargetChangeInvalidatesCheck',
    'touchTargetsAtLeast44CssPixels',
    'supportedWindowsScale',
    'sameContentBoundsAsBaseline',
    'progressiveLoadCaptured',
    'sameSizeBeforeAfter',
    'narrowLayoutKeepsFooterVisible',
    'closeAndEscapeBlockedDuringCommit',
    'mixedImportSuccessReceipt',
    'terminalImportClearsChecksKeepsReceipt',
    'repeatImportUsesFreshSession',
    'stopAfterCurrentReceipt',
    'duplicateImportIsNoOp',
    'partialFailureRetainsFirstCommit',
    'mixedAssetsPersistAfterReopen',
    'originalFlaUnchanged',
  ];
  const missing = requiredAssertions.filter((name) => runtime.assertions[name] !== true);
  assert(missing.length === 0, 'Missing C03 evidence assertions: ' + missing.join(', '));
  await writeReceipt('PASS', { productAcceptance: 'OWNER_HUMAN_VISUAL_ACCEPTANCE_REQUIRED' });
  app.quit();
}

app.whenReady()
  .then(main)
  .catch(async (error) => {
    runtime.failure = error instanceof Error ? error.message : String(error);
    process.stderr.write(JSON.stringify({ status: 'FAIL', error: runtime.failure }) + '\n');
    try {
      if (runtime.runRoot && runtime.evidenceDirectory) {
        await writeReceipt('FAIL', { error: runtime.failure });
      }
    } catch {
      // Preserve the original verifier failure if evidence writing also fails.
    }
    app.exit(1);
  });
