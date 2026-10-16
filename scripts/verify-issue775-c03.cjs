#!/usr/bin/env node
/* global document, Element, HTMLElement, HTMLDetailsElement, HTMLInputElement, HTMLButtonElement, HTMLImageElement, getComputedStyle */
/**
 * Issue #775 C03 bounded Windows Electron workbench evidence.
 *
 * The real source FLA is opened read-only. Test projects and the Electron
 * profile live under the external acceptance root. Evidence defaults to
 * docs/evidence/issue-775-c03; --g007-only supports the bounded Issue #781
 * run, and --g007-baseline captures the same source against the old layout.
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
  g007Only: false,
  g007Baseline: false,
  g007BaselineReceipt: null,
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
    else if (argv[index] === '--evidence-root') args.evidenceRoot = argv[++index];
    else if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--g007-only') args.g007Only = true;
    else if (argv[index] === '--g007-baseline') args.g007Baseline = true;
    else if (argv[index] === '--baseline-receipt') args.baselineReceipt = argv[++index];
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

async function mouseClickCandidateCheckbox(window, targetId) {
  const target = await inPage(window, (wantedTargetId) => {
    const row = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')]
      .find((candidate) => {
        try { return JSON.parse(candidate.dataset.candidateIdentity ?? '[]').includes(wantedTargetId); }
        catch { return false; }
      });
    const hitbox = row?.querySelector('.fla-c03-checkbox-hitbox');
    const checkbox = hitbox?.querySelector('input[type="checkbox"]');
    if (!(hitbox instanceof HTMLElement) || !(checkbox instanceof HTMLInputElement)) return null;
    hitbox.scrollIntoView({ block: 'nearest' });
    const rect = hitbox.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  }, targetId);
  assert(target && target.width >= 48 && target.height >= 48,
    'The checkbox hitbox must remain at least 48 CSS pixels before a mouse click.');

  window.show();
  window.focus();
  window.webContents.focus();
  await delay(50);
  const x = Math.round(target.x);
  const y = Math.round(target.y);
  window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await waitForPage(window, (wantedTargetId) => [...document.querySelectorAll(
    '.fla-c03-candidate[data-candidate-kind="snapshot"]',
  )].some((row) => {
    try {
      return JSON.parse(row.dataset.candidateIdentity ?? '[]').includes(wantedTargetId) &&
        row.querySelector('input[type="checkbox"]')?.checked === true;
    } catch {
      return false;
    }
  }), [targetId]);

  return inPage(window, (wantedTargetId) => {
    const row = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')]
      .find((candidate) => {
        try { return JSON.parse(candidate.dataset.candidateIdentity ?? '[]').includes(wantedTargetId); }
        catch { return false; }
      });
    const checkbox = row?.querySelector('input[type="checkbox"]');
    const hitbox = checkbox?.closest('.fla-c03-checkbox-hitbox');
    const rect = hitbox?.getBoundingClientRect();
    return {
      checked: checkbox?.checked === true,
      focused: document.activeElement === checkbox,
      selectedCount: document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length,
      hitboxWidth: rect?.width ?? 0,
      hitboxHeight: rect?.height ?? 0,
      outlineWidth: hitbox ? Number.parseFloat(getComputedStyle(hitbox).outlineWidth) : 0,
      outlineStyle: hitbox ? getComputedStyle(hitbox).outlineStyle : 'none',
    };
  }, targetId);
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
  await delay(80);
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

async function verifyShortCandidateLabelOnTouch(window) {
  const target = await inPage(window, () => {
    for (const row of document.querySelectorAll('.fla-c03-candidate')) {
      const button = row.querySelector('.fla-c03-candidate-focus');
      const label = row.querySelector('.fla-c03-candidate-copy strong');
      if (!(button instanceof HTMLButtonElement) || !(label instanceof HTMLElement)) continue;
      const accessibleLabel = button.getAttribute('aria-label') ?? '';
      const fullLabel = accessibleLabel.replace(/^预览\s*/u, '').replace(/\s*·\s*连续画面$/u, '').trim();
      const cardLabel = label.textContent?.replace(/\s*·\s*连续画面$/u, '').trim() ?? '';
      if (!fullLabel || !cardLabel || fullLabel === cardLabel) continue;
      button.scrollIntoView({ block: 'center' });
      const rect = button.getBoundingClientRect();
      return {
        identity: row.dataset.candidateIdentity ?? '',
        kind: row.dataset.candidateKind ?? '',
        fullLabel,
        cardLabel,
        accessibleLabel,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        selectedCount: document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length,
      };
    }
    return null;
  });
  assert(target, 'No source-backed shortened candidate label was available for the touch focus check.');
  assert(target.accessibleLabel.includes(target.fullLabel),
    `The shortened candidate label did not expose its full accessible name: ${JSON.stringify(target)}.`);

  const debuggerApi = window.webContents.debugger;
  const attachedHere = !debuggerApi.isAttached();
  if (attachedHere) debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: target.x, y: target.y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(50);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
  await waitForPage(window, (label) =>
    document.querySelector('[data-testid="fla-c03-focused-label"]')?.textContent?.trim() === label,
  [target.fullLabel], 10_000);
  const after = await readCandidateFacts(window);
  assert(after.selectedCount === target.selectedCount,
    'Touching a shortened candidate name selected the candidate instead of only opening its full-name preview.');
  runtime.assertions.shortCandidateFullNameAvailableOnTouch = true;
  runtime.layout.shortCandidateNameOnTouch = {
    kind: target.kind,
    cardLabel: target.cardLabel,
    fullLabel: target.fullLabel,
    accessibleLabel: target.accessibleLabel,
    focusedLabel: target.fullLabel,
    selectionCountBefore: target.selectedCount,
    selectionCountAfter: after.selectedCount,
  };
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
  const eligible = entries.filter((entry) =>
    entry.frameCount >= 26 && entry.previewSupported && !entry.isBlank,
  );
  if (runtime.g007Only) {
    return eligible.reduce((longest, entry) => !longest || entry.frameCount > longest.frameCount ? entry : longest, null);
  }
  return eligible[0] ?? null;
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

async function waitForSnapshotCatalogScan(window) {
  const readState = () => inPage(window, () => {
    const rows = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')];
    return {
      candidateCount: rows.length,
      unresolvedCount: rows.filter((row) => ['checking', 'unscanned'].includes(row.dataset.previewStatus)).length,
      progressText: document.querySelector('[data-testid="fla-c03-catalog-progress"]')?.textContent?.trim() ?? '',
    };
  });
  try {
    await waitForPage(window, () => {
      const rows = [...document.querySelectorAll('.fla-c03-candidate[data-candidate-kind="snapshot"]')];
      return rows.length > 0 && rows.every((row) => !['checking', 'unscanned'].includes(row.dataset.previewStatus));
    }, [], 180_000);
  } catch (error) {
    runtime.layout.g007SnapshotScan = await readState();
    throw error;
  }
  runtime.layout.g007SnapshotScan = await readState();
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
  await verifyShortCandidateLabelOnTouch(window);
  await click(window, '[data-testid="fla-c03-select-current-results"]');
  await waitForSelector(window, '[data-testid="fla-c03-bulk-confirmation"]');
  const readBulkConfirmation = () => inPage(window, () => {
    const rows = [...document.querySelectorAll('.fla-c03-candidate')];
    const eligibleRows = rows.filter((row) =>
      row.dataset.selectable === 'true' && row.querySelector('input[type="checkbox"]')?.checked !== true,
    );
    const panel = document.querySelector('[data-testid="fla-c03-bulk-confirmation"]');
    const confirmationText = panel?.querySelector('span')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    const buttonText = panel?.querySelector('[data-testid="fla-c03-bulk-confirm"]')?.textContent?.trim() ?? '';
    const countMatch = confirmationText.match(/即将勾选\s*([0-9]+)\s*项素材，暂不会导入/u);
    return {
      confirmationText,
      buttonText,
      confirmationCount: Number(countMatch?.[1] ?? 0),
      eligibleCount: eligibleRows.length,
      eligibleByKind: eligibleRows.reduce((counts, row) => {
        const kind = row.dataset.candidateKind ?? 'missing';
        counts[kind] = (counts[kind] ?? 0) + 1;
        return counts;
      }, {}),
      candidateRowCount: rows.length,
    };
  });
  const confirmationBeforeCancel = await readBulkConfirmation();
  assert(confirmationBeforeCancel.confirmationCount === confirmationBeforeCancel.eligibleCount &&
    confirmationBeforeCancel.confirmationCount === expectedEligible,
  `Bulk confirmation did not describe all eligible results: ${JSON.stringify(confirmationBeforeCancel)}.`);
  assert(confirmationBeforeCancel.buttonText === '确认勾选' &&
    !/[0-9]/u.test(confirmationBeforeCancel.buttonText) && !/添加/u.test(confirmationBeforeCancel.buttonText),
  `Bulk confirmation action copy still implies a count or import: ${confirmationBeforeCancel.buttonText}.`);
  runtime.screenshots.bulkConfirmation = await capture(window, 'bulk-confirmation');
  const projectBeforeBulkCancel = await readProjectState(runtime.project.root);
  await click(window, '[data-testid="fla-c03-bulk-cancel"]');
  await waitForPage(window, () => !document.querySelector('[data-testid="fla-c03-bulk-confirmation"]'));
  const cancelledBulkFacts = await readCandidateFacts(window);
  const projectAfterBulkCancel = await readProjectState(runtime.project.root);
  runtime.layout.bulkCancellation = {
    selectedCount: cancelledBulkFacts.selectedCount,
    before: projectBeforeBulkCancel,
    after: projectAfterBulkCancel,
  };
  assert(cancelledBulkFacts.selectedCount === 0 &&
    projectAfterBulkCancel.sha256 === projectBeforeBulkCancel.sha256 &&
    projectAfterBulkCancel.revision === projectBeforeBulkCancel.revision,
  `Cancelling bulk selection changed selection or project state: ${JSON.stringify(runtime.layout.bulkCancellation)}.`);
  runtime.assertions.bulkCancelNoMutation = true;
  runtime.screenshots.bulkConfirmationCancelled = await capture(window, 'bulk-confirmation-cancelled');

  await click(window, '[data-testid="fla-c03-select-current-results"]');
  await waitForSelector(window, '[data-testid="fla-c03-bulk-confirmation"]');
  const confirmationFacts = await readBulkConfirmation();
  assert(confirmationFacts.confirmationCount === confirmationFacts.eligibleCount &&
    confirmationFacts.confirmationCount === expectedEligible &&
    confirmationFacts.buttonText === '确认勾选',
  `Bulk confirmation copy or count changed before confirmation: ${JSON.stringify(confirmationFacts)}.`);
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
    const confirmationText = document.querySelector('[data-testid="fla-c03-bulk-confirmation"] span')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    const displayedCount = Number(confirmationText.match(/即将勾选\s*([0-9]+)/u)?.[1] ?? 0);
    const eligibleByKind = eligibleRows.reduce((counts, row) => {
      const kind = row.dataset.candidateKind ?? 'missing';
      counts[kind] = (counts[kind] ?? 0) + 1;
      return counts;
    }, {});
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return { buttonText, displayedCount, eligibleCount: eligibleRows.length, eligibleByKind, clicked: false };
    }
    button.click();
    return { confirmationText, buttonText, displayedCount, eligibleCount: eligibleRows.length, eligibleByKind, clicked: true };
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

  const highCountBounds = window.getBounds();
  const highCountContentBounds = window.getContentBounds();
  try {
    window.setBounds({ x: highCountBounds.x, y: highCountBounds.y, width: 800, height: 690 });
    await delay(500);
    const highCountNarrow = await inPage(window, () => {
      const toolbar = document.querySelector('.fla-c03-browser-tools');
      const toolbarRect = toolbar?.getBoundingClientRect();
      const elements = toolbar
        ? [...toolbar.children].filter((child) => child.matches('.fla-c03-search, button'))
        : [];
      const controls = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.matches('.fla-c03-search') ? 'search' : element.textContent?.trim() ?? '',
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
        };
      });
      let overlap = false;
      for (let first = 0; first < controls.length; first += 1) {
        for (let second = first + 1; second < controls.length; second += 1) {
          const a = controls[first];
          const b = controls[second];
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
            overlap = true;
          }
        }
      }
      const selectedView = document.querySelector('[data-testid="fla-c03-selected-view"]');
      const primary = document.querySelector('[data-testid="fla-unified-import"]');
      const primaryRect = primary?.getBoundingClientRect();
      const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
      const footerRect = footer?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        flexWrap: toolbar ? getComputedStyle(toolbar).flexWrap : '',
        toolbarWidth: toolbarRect?.width ?? 0,
        inside: Boolean(toolbarRect) && controls.length === 4 && controls.every((rect) =>
          rect.left >= toolbarRect.left - 1 && rect.right <= toolbarRect.right + 1 && rect.height >= 44,
        ),
        overlap,
        selectedLabel: selectedView?.textContent?.trim() ?? '',
        primary: {
          text: primary?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
          disabled: primary?.disabled ?? true,
          width: primaryRect?.width ?? 0,
          height: primaryRect?.height ?? 0,
          scrollWidth: primary?.scrollWidth ?? 0,
          clientWidth: primary?.clientWidth ?? 0,
          scrollHeight: primary?.scrollHeight ?? 0,
          clientHeight: primary?.clientHeight ?? 0,
        },
        footerVisible: Boolean(footerRect && footerRect.height > 0 &&
          footerRect.top < window.innerHeight && footerRect.bottom <= window.innerHeight + 1),
      };
    }, confirmedCount);
    runtime.layout.highCountNarrow = highCountNarrow;
    assert(highCountNarrow.viewportWidth <= 800 && highCountNarrow.inside && !highCountNarrow.overlap &&
      highCountNarrow.selectedLabel === `已选 ${confirmedCount}` &&
      highCountNarrow.primary.text === `导入 ${confirmedCount} 项` && !highCountNarrow.primary.disabled &&
      highCountNarrow.primary.scrollWidth <= highCountNarrow.primary.clientWidth + 1 &&
      highCountNarrow.primary.scrollHeight <= highCountNarrow.primary.clientHeight + 1 &&
      highCountNarrow.footerVisible,
    `The compact toolbar or large selected-count action clipped at the narrowest native Windows viewport: ${JSON.stringify(highCountNarrow)}.`);
    runtime.assertions.narrowResponsiveToolbarAndLargeCount = true;
    runtime.screenshots.highCountNarrow = await capture(window, 'high-count-narrow');

    const narrowPausedQuery = `c03-narrow-no-result-${runtime.runId}`;
    await setInput(window, '[data-testid="fla-c03-search"]', narrowPausedQuery);
    await waitForSelector(window, '[data-testid="fla-c03-empty-state"]');
    await click(window, '[data-testid="fla-c03-selected-view"]');
    await waitForPage(window, () =>
      document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.dataset.view === 'selected',
    );
    const narrowSelectedView = await inPage(window, () => ({
      query: document.querySelector('[data-testid="fla-c03-search"]')?.value ?? '',
      searchDisabled: document.querySelector('[data-testid="fla-c03-search"]')?.disabled ?? false,
      selectedLabel: document.querySelector('[data-testid="fla-c03-selected-view"]')?.textContent?.trim() ?? '',
      statusText: document.querySelector('[data-testid="fla-c03-selected-view-status"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      count: document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length,
    }));
    runtime.layout.narrowSelectedView = narrowSelectedView;
    assert(narrowSelectedView.query === narrowPausedQuery && narrowSelectedView.searchDisabled &&
      narrowSelectedView.selectedLabel === '返回浏览' &&
      narrowSelectedView.statusText === '正在查看已选 · 搜索已暂停' &&
      narrowSelectedView.count === confirmedCount,
    `The narrow selected-only view did not preserve its query, count, and return copy: ${JSON.stringify(narrowSelectedView)}.`);
    runtime.assertions.narrowSelectedViewReturnAndPausedSearch = true;
    runtime.screenshots.selectedViewNarrow = await capture(window, 'selected-view-narrow');
    await click(window, '[data-testid="fla-c03-selected-view"]');
    await waitForPage(window, () =>
      document.querySelector('[data-testid="fla-c03-candidate-grid"]')?.dataset.view === 'browse',
    );
    const narrowQueryAfterReturn = await inPage(window, () =>
      document.querySelector('[data-testid="fla-c03-search"]')?.value ?? '',
    );
    assert(narrowQueryAfterReturn === narrowPausedQuery,
      `Returning from narrow selected-only view changed the query to ${narrowQueryAfterReturn}.`);
    await setInput(window, '[data-testid="fla-c03-search"]', '');
    await waitForPage(window, () => document.querySelectorAll('.fla-c03-candidate').length >= 336);
  } finally {
    window.setPosition(highCountBounds.x, highCountBounds.y);
    window.setContentSize(
      highCountContentBounds.width,
      highCountContentBounds.height,
    );
    await delay(500);
  }

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
  const queryAfterReturn = await inPage(window, () => document.querySelector('[data-testid="fla-c03-search"]')?.value ?? '');
  assert(Math.abs(scrollAfter - scrollBefore) < 2 && queryAfterReturn === selectedFacts.search,
    `Returning to browse did not restore scroll position and preserve the query (scroll ${scrollBefore} -> ${scrollAfter}, query ${queryAfterReturn}).`);
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
  const selectedViewSearchFacts = await inPage(window, () => ({
    query: document.querySelector('[data-testid="fla-c03-search"]')?.value ?? '',
    searchDisabled: document.querySelector('[data-testid="fla-c03-search"]')?.disabled ?? false,
    statusText: document.querySelector('[data-testid="fla-c03-selected-view-status"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
  }));
  assert(selectedViewSearchFacts.query === 'c03-no-result-' + runtime.runId &&
    selectedViewSearchFacts.searchDisabled &&
    selectedViewSearchFacts.statusText === '正在查看已选 · 搜索已暂停',
  `Selected-only mode did not explain the paused search while preserving its query: ${JSON.stringify(selectedViewSearchFacts)}.`);
  runtime.assertions.selectedViewPreservesQueryAndExplainsPause = true;
  runtime.layout.selectedViewSearch = selectedViewSearchFacts;
  runtime.assertions.selectedViewIgnoresSearch = true;
  runtime.screenshots.selectedViewIgnoresSearch = await capture(window, 'selected-view-ignores-search');
  await click(window, '[data-testid="fla-c03-selected-view"]');
  const searchAfterSelectedReturn = await inPage(window, () => document.querySelector('[data-testid="fla-c03-search"]')?.value ?? '');
  assert(searchAfterSelectedReturn === 'c03-no-result-' + runtime.runId,
    `Returning from the search-paused selected-only view changed the query to ${searchAfterSelectedReturn}.`);
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

async function renderSequenceRange(window, target, startOneBased, expectedCount, screenshotName, activation = 'mouse') {
  await setInput(window, '[data-testid="fla-frame-sequence-start"]', String(startOneBased));
  const startIndex = startOneBased - 1;
  const endIndex = Math.min(target.frameCount - 1, startIndex + 23);
  const expectedSummary = `第 ${startOneBased}–${endIndex + 1} 帧 · 共 ${expectedCount} 帧`;
  await waitForPage(window, (expectedStart, expectedEnd, expectedUiStart, summaryText, checkSummary) => {
    const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
    const input = document.querySelector('[data-testid="fla-frame-sequence-start"]');
    const summary = document.querySelector('[data-testid="fla-frame-sequence-range-summary"]');
    return range?.dataset.rangeStart === expectedStart && range?.dataset.rangeEnd === expectedEnd &&
      input?.value === expectedUiStart &&
      (!checkSummary || summary?.textContent?.replace(/\s+/gu, ' ').trim() === summaryText);
  }, [String(startIndex), String(endIndex), String(startOneBased), expectedSummary, !runtime.g007Baseline]);
  await waitForPage(window, () => {
    const button = document.querySelector('[data-testid="fla-frame-sequence-render"]');
    return button instanceof HTMLButtonElement && !button.disabled;
  }, [], 120_000);
  runtime.layout.sequenceActionReady = await inPage(window, () => {
    const button = document.querySelector('[data-testid="fla-frame-sequence-render"]');
    const status = document.querySelector('[data-testid="fla-frame-sequence-preview-status"]');
    return {
      enabled: button instanceof HTMLButtonElement && !button.disabled,
      previewState: status?.dataset.previewState ?? null,
      focusedTargetId: document.querySelector('[data-testid="fla-frame-sequence-details-region"]')?.getAttribute('data-focused-target-id') ?? null,
    };
  });
  const beforeCount = runtime.sequenceRenders.length;
  if (runtime.g007Only) runtime.failureStage = 'g007-sequence-' + screenshotName;
  if (activation === 'keyboard' || activation === 'keyboard-space') {
    await inPage(window, () => document.querySelector('[data-testid="fla-frame-sequence-start"]')?.focus());
    await sendInputKey(window, 'Tab');
    const focus = await inPage(window, () => {
      const button = document.querySelector('[data-testid="fla-frame-sequence-render"]');
      const style = button ? getComputedStyle(button) : null;
      return {
        focused: document.activeElement === button,
        outlineWidth: style ? Number.parseFloat(style.outlineWidth) : 0,
        outlineStyle: style?.outlineStyle ?? 'none',
        accessibleName: button?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      };
    });
    assert(focus.focused && focus.outlineWidth >= 2 && focus.outlineStyle !== 'none' && focus.accessibleName,
      'Tab did not reach the sequence action with a visible keyboard focus ring: ' + JSON.stringify(focus));
    runtime.layout.sequenceOperationKeyboard = focus;
    runtime.assertions.sequenceOperationKeyboardAccessible = true;
    await sendInputKey(window, activation === 'keyboard-space' ? 'Space' : 'Enter');
  } else {
    await click(window, '[data-testid="fla-frame-sequence-render"]');
  }
  try {
    runtime.layout.sequenceGenerationStarted = await waitForPage(window, () => {
      const status = document.querySelector('[data-testid="fla-frame-sequence-preview-status"]');
      const state = status?.dataset.previewState;
      if (!['rendering', 'valid', 'error', 'cancelled'].includes(state ?? '')) return null;
      return {
        previewState: state,
        progress: document.querySelector('[data-testid="fla-frame-sequence-progress"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
        error: document.querySelector('[data-testid="fla-frame-sequence-error"]')?.textContent?.trim() ?? '',
      };
    }, [], 15_000);
    assert(['rendering', 'valid'].includes(runtime.layout.sequenceGenerationStarted.previewState),
      'Activating sequence generation reached a terminal state without a valid preview: ' +
      JSON.stringify(runtime.layout.sequenceGenerationStarted));
    if (activation === 'keyboard-space') runtime.assertions.sequenceSpaceActivatesOperation = true;
    if (activation === 'keyboard') runtime.assertions.sequenceEnterActivatesOperation = true;
  } catch (error) {
    runtime.layout.sequenceGenerationFailure = await inPage(window, () => ({
      previewState: document.querySelector('[data-testid="fla-frame-sequence-preview-status"]')?.dataset.previewState ?? null,
      progress: document.querySelector('[data-testid="fla-frame-sequence-progress"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      error: document.querySelector('[data-testid="fla-frame-sequence-error"]')?.textContent?.trim() ?? '',
      filmstripFrameCount: document.querySelectorAll('[data-testid="fla-frame-sequence-filmstrip"] [data-frame-index]').length,
      renderButtonDisabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled ?? null,
    }));
    throw error;
  }
  try {
    await waitForPage(window, (expected) =>
      document.querySelectorAll('[data-testid="fla-frame-sequence-filmstrip"] [data-frame-index]').length === expected &&
      document.querySelector('[data-testid="fla-frame-sequence-preview-status"]')?.dataset.previewState === 'valid',
    [expectedCount], 300_000);
  } catch (error) {
    runtime.layout.sequenceGenerationFailure = await inPage(window, () => ({
      previewState: document.querySelector('[data-testid="fla-frame-sequence-preview-status"]')?.dataset.previewState ?? null,
      progress: document.querySelector('[data-testid="fla-frame-sequence-progress"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      error: document.querySelector('[data-testid="fla-frame-sequence-error"]')?.textContent?.trim() ?? '',
      filmstripFrameCount: document.querySelectorAll('[data-testid="fla-frame-sequence-filmstrip"] [data-frame-index]').length,
      renderButtonDisabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled ?? null,
    }));
    throw error;
  }
  assert(runtime.sequenceRenders.length === beforeCount + 1, 'Sequence generation did not make exactly one Main request.');
  const request = runtime.sequenceRenders.at(-1);
  assert(request.ok && request.range.startFrameIndex === startIndex && request.range.endFrameIndex === endIndex,
    'Main sequence request did not match the user-facing range.');
  runtime.screenshots[screenshotName] = await capture(window, screenshotName);
  return request;
}

async function readGeneratedSequencePreview(window) {
  return inPage(window, () => {
    const preview = document.querySelector('[data-testid="fla-frame-sequence-preview-area"]');
    const image = document.querySelector('[data-testid="fla-frame-sequence-preview-image"]');
    const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
    const filmstrip = document.querySelector('[data-testid="fla-frame-sequence-filmstrip-region"]');
    const panel = document.querySelector('[data-testid="fla-c03-preview"]');
    const slot = document.querySelector('[data-testid="fla-c03-sequence-preview-slot"]');
    const legacyCanvas = document.querySelector('[data-testid="fla-c03-preview-stage"]');
    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom,
        width: value.width, height: value.height };
    };
    const previewRect = rect(preview);
    const imageRect = rect(image);
    const rangeRect = rect(range);
    const filmstripRect = rect(filmstrip);
    const style = image instanceof HTMLImageElement ? getComputedStyle(image) : null;
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const container = slot ?? legacyCanvas;
    const containerStyle = container ? getComputedStyle(container) : null;
    const zoomValue = panelStyle?.getPropertyValue('--fla-c03-zoom').trim() ||
      containerStyle?.getPropertyValue('--fla-c03-zoom').trim() || 'NaN';
    const zoom = Number.parseFloat(zoomValue);
    const transformParts = style?.transform.match(/^matrix\(([^)]+)\)$/u)?.[1]
      ?.split(',').map((part) => Number(part.trim())) ?? [];
    const transformScale = transformParts.length === 6
      ? { x: Math.hypot(transformParts[0], transformParts[1]), y: Math.hypot(transformParts[2], transformParts[3]) }
      : { x: 1, y: 1 };
    let alphaBounds = null;
    let pixelReadError = null;
    if (image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('2D canvas context unavailable');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width;
        let top = canvas.height;
        let right = -1;
        let bottom = -1;
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
        }
        if (right >= left && bottom >= top) {
          alphaBounds = { left, top, width: right - left + 1, height: bottom - top + 1 };
        }
      } catch (error) {
        pixelReadError = error instanceof Error ? error.message : String(error);
      }
    }
    let displayedContent = null;
    let visibleContentRatio = null;
    if (image instanceof HTMLImageElement && imageRect && previewRect && alphaBounds &&
      image.clientWidth > 0 && image.clientHeight > 0) {
      const fitScale = Math.min(image.clientWidth / image.naturalWidth, image.clientHeight / image.naturalHeight);
      const fittedWidth = image.naturalWidth * fitScale;
      const fittedHeight = image.naturalHeight * fitScale;
      const left = imageRect.left + (imageRect.width - fittedWidth * transformScale.x) / 2 +
        alphaBounds.left * fitScale * transformScale.x;
      const top = imageRect.top + (imageRect.height - fittedHeight * transformScale.y) / 2 +
        alphaBounds.top * fitScale * transformScale.y;
      const width = alphaBounds.width * fitScale * transformScale.x;
      const height = alphaBounds.height * fitScale * transformScale.y;
      displayedContent = { left, top, right: left + width, bottom: top + height, width, height };
      const visibleWidth = Math.max(0, Math.min(displayedContent.right, previewRect.right) -
        Math.max(displayedContent.left, previewRect.left));
      const visibleHeight = Math.max(0, Math.min(displayedContent.bottom, previewRect.bottom) -
        Math.max(displayedContent.top, previewRect.top));
      visibleContentRatio = Number(((visibleWidth * visibleHeight) / (width * height)).toFixed(4));
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      container: rect(container),
      containerOverflow: containerStyle?.overflow ?? '',
      preview: previewRect,
      image: imageRect,
      range: rangeRect,
      filmstrip: filmstripRect,
      gridRows: containerStyle?.gridTemplateRows ?? '',
      rangeOutsideCanvas: Boolean(range && !range.closest('.fla-c03-preview-stage')),
      rangeBelowCanvas: Boolean(rangeRect && previewRect && rangeRect.top >= previewRect.bottom - 1),
      filmstripBelowRange: Boolean(filmstripRect && rangeRect && filmstripRect.top >= rangeRect.bottom - 1),
      rangeSummary: document.querySelector('[data-testid="fla-frame-sequence-range-summary"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      previewBackgroundImage: preview ? getComputedStyle(preview).backgroundImage : '',
      imageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      objectFit: style?.objectFit ?? '',
      zoom,
      transformScale,
      naturalWidth: image instanceof HTMLImageElement ? image.naturalWidth : 0,
      naturalHeight: image instanceof HTMLImageElement ? image.naturalHeight : 0,
      alphaBounds,
      pixelReadError,
      displayedContent,
      visibleContentRatio,
      contentHeightRatio: displayedContent && previewRect
        ? Number((displayedContent.height / previewRect.height).toFixed(4))
        : null,
    };
  });
}

async function dispatchTouchScroll(window, selector, deltaY) {
  const point = await inPage(window, (query) => {
    const element = document.querySelector(query);
    if (!(element instanceof HTMLElement)) return null;
    element.scrollTop = 0;
    const rect = element.getBoundingClientRect();
    const state = { startCount: 0, moveCount: 0, scrollTopBefore: element.scrollTop };
    const onStart = (event) => { if (element.contains(event.target)) state.startCount += 1; };
    const onMove = (event) => { if (element.contains(event.target)) state.moveCount += 1; };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    window.__issue778GeneratedSequenceTouch = { query, element, state, onStart, onMove };
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + Math.min(120, Math.max(24, rect.height / 2)),
      scrollTopBefore: state.scrollTopBefore,
    };
  }, selector);
  assert(point, 'Narrow generated-sequence workbench did not expose a touch scroll area.');

  const debuggerApi = window.webContents.debugger;
  const attachedHere = !debuggerApi.isAttached();
  if (attachedHere) debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(40);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: point.x, y: point.y - deltaY, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(80);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
  await delay(120);
  return inPage(window, (query) => {
    const touch = window.__issue778GeneratedSequenceTouch;
    if (!touch || touch.query !== query) return null;
    document.removeEventListener('touchstart', touch.onStart);
    document.removeEventListener('touchmove', touch.onMove);
    return {
      dispatchedBy: 'Electron CDP Input.dispatchTouchEvent',
      touchStartCount: touch.state.startCount,
      touchMoveCount: touch.state.moveCount,
      scrollTopBefore: touch.state.scrollTopBefore,
      scrollTopAfter: touch.element.scrollTop,
      scrollHeight: touch.element.scrollHeight,
      clientHeight: touch.element.clientHeight,
    };
  }, selector);
}

async function verifySequence560CssBreakpointSimulation(window) {
  const debuggerApi = window.webContents.debugger;
  const attachedHere = !debuggerApi.isAttached();
  if (attachedHere) debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 560,
      // Keep the shell in landscape so its asset-library-owned review portal
      // remains mounted while exercising the 560 CSS-pixel width breakpoint.
      height: 500,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(500);
    await inPage(window, () => {
      const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
      if (workbench instanceof HTMLElement) workbench.scrollTop = 0;
    });
    const facts = await inPage(window, () => {
      const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
      const canvas = document.querySelector('[data-testid="fla-frame-sequence-preview-area"]');
      const input = document.querySelector('[data-testid="fla-frame-sequence-start"]');
      const action = document.querySelector('[data-testid="fla-frame-sequence-rerender"]');
      const filmstripItem = document.querySelector('[data-testid="fla-frame-sequence-filmstrip"] button');
      const size = (element) => {
        const rect = element?.getBoundingClientRect();
        return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
      };
      const workbenchRect = workbench?.getBoundingClientRect();
      const canvasRect = canvas?.getBoundingClientRect();
      return {
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        breakpointActive: window.matchMedia('(max-width: 560px)').matches,
        pageDiagnostics: {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          bodyText: document.body?.innerText?.slice(0, 500) ?? '',
          bodyChildCount: document.body?.children.length ?? 0,
          workbenchCount: document.querySelectorAll('[data-testid="fla-c03-workbench"]').length,
        },
        canvasFullyVisibleWithoutScrolling: Boolean(workbenchRect && canvasRect &&
          canvasRect.top >= workbenchRect.top - 1 && canvasRect.bottom <= workbenchRect.bottom + 1),
        rangeInputSize: size(input),
        actionSize: size(action),
        filmstripItemSize: size(filmstripItem),
      };
    });
    runtime.layout.sequence560CssBreakpointSimulation = {
      inputMethod: 'Chromium CDP Emulation.setDeviceMetricsOverride',
      windowsNativeMeasurement: false,
      emulatedDeviceScaleFactor: 1,
      ...facts,
    };
    runtime.screenshots.sequence560CssBreakpointSimulation = await capture(
      window,
      'sequence-generated-560-css-simulation',
    );
    const touch = await dispatchTouchScroll(
      window,
      '[data-testid="fla-c03-workbench"]',
      260,
    );
    const reachability = await inPage(window, () => {
      const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
      const rangeInput = document.querySelector('[data-testid="fla-frame-sequence-start"]');
      const action = document.querySelector('[data-testid="fla-frame-sequence-rerender"]');
      const filmstripItem = document.querySelector('[data-testid="fla-frame-sequence-filmstrip"] button');
      const visible = (element) => {
        if (!(workbench instanceof HTMLElement) || !(element instanceof Element)) return false;
        const rect = element.getBoundingClientRect();
        const parent = workbench.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 &&
          rect.left >= parent.left - 1 && rect.right <= parent.right + 1 &&
          rect.top >= parent.top - 1 && rect.bottom <= parent.bottom + 1 &&
          rect.left >= 0 && rect.right <= window.innerWidth &&
          rect.top >= 0 && rect.bottom <= window.innerHeight;
      };
      return {
        rangeInputVisible: visible(rangeInput),
        actionVisible: visible(action),
        filmstripItemVisible: visible(filmstripItem),
        workbenchScrollTop: workbench instanceof HTMLElement ? workbench.scrollTop : 0,
      };
    });
    runtime.layout.sequence560CssBreakpointSimulation.touch = touch;
    runtime.layout.sequence560CssBreakpointSimulation.controlsReachableAfterTouch = reachability;
    runtime.screenshots.sequence560CssBreakpointSimulationControls = await capture(
      window,
      'sequence-generated-560-css-simulation-controls',
    );
    assert(facts.viewport.width === 560 && facts.breakpointActive &&
      facts.canvasFullyVisibleWithoutScrolling &&
      facts.rangeInputSize.width >= 44 && facts.rangeInputSize.height >= 44 &&
      facts.actionSize.width >= 44 && facts.actionSize.height >= 44 &&
      facts.filmstripItemSize.width >= 44 && facts.filmstripItemSize.height >= 44 &&
      touch?.touchStartCount > 0 && touch.touchMoveCount > 0 && touch.scrollTopAfter > touch.scrollTopBefore &&
      reachability.rangeInputVisible && reachability.actionVisible && reachability.filmstripItemVisible,
    'The simulated 560 CSS-pixel breakpoint did not preserve the full canvas and touch-sized controls: ' +
      JSON.stringify(runtime.layout.sequence560CssBreakpointSimulation));
    runtime.assertions.sequence560CssBreakpointSimulation = true;
  } finally {
    try {
      if (debuggerApi.isAttached()) await debuggerApi.sendCommand('Emulation.clearDeviceMetricsOverride');
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
    }
  }
}

async function captureGeneratedSequenceNarrow(window) {
  const bounds = window.getBounds();
  try {
    window.setBounds({ x: bounds.x, y: bounds.y, width: 860, height: 690 });
    await delay(500);
    const viewport = await inPage(window, () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    }));
    assert(viewport.width <= 900, 'Generated-sequence narrow evidence did not reach the responsive layout.');
    runtime.layout.sequenceGeneratedNarrowViewport = viewport;
    await inPage(window, () => {
      const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
      if (workbench instanceof HTMLElement) workbench.scrollTop = 0;
    });
    runtime.layout.sequenceGeneratedNarrowPreview = await readGeneratedSequencePreview(window);
    const narrowPreview = runtime.layout.sequenceGeneratedNarrowPreview;
    assert(narrowPreview.preview?.height >= 210 && narrowPreview.imageLoaded &&
      narrowPreview.objectFit === 'contain' && narrowPreview.zoom === 1 &&
      narrowPreview.visibleContentRatio >= 0.99 && narrowPreview.contentHeightRatio >= 0.65 &&
      narrowPreview.container?.bottom >= narrowPreview.filmstrip?.bottom - 1,
    'The complete generated frame was not visible at fit zoom in the narrow Windows view: ' +
      JSON.stringify(narrowPreview));
    runtime.layout.sequenceGeneratedNarrowCanvasVisibility = await inPage(window, () => {
      const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
      const canvas = document.querySelector('[data-testid="fla-frame-sequence-preview-area"]');
      if (!(workbench instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return null;
      const workbenchRect = workbench.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      return {
        workbenchTop: workbenchRect.top,
        workbenchBottom: workbenchRect.bottom,
        canvasTop: canvasRect.top,
        canvasBottom: canvasRect.bottom,
        fullyVisibleWithoutScrolling: canvasRect.top >= workbenchRect.top - 1 &&
          canvasRect.bottom <= workbenchRect.bottom + 1,
      };
    });
    assert(runtime.layout.sequenceGeneratedNarrowCanvasVisibility?.fullyVisibleWithoutScrolling,
      'The full character canvas did not fit in the narrow workbench without scrolling: ' +
        JSON.stringify(runtime.layout.sequenceGeneratedNarrowCanvasVisibility));
    runtime.screenshots.sequenceGeneratedNarrowTop = await capture(window, 'sequence-generated-narrow-top');

    runtime.layout.sequenceGeneratedNarrowTouch = await dispatchTouchScroll(
      window,
      '[data-testid="fla-c03-workbench"]',
      260,
    );
    runtime.layout.sequenceGeneratedNarrowReachability = await inPage(window, () => {
      const workbench = document.querySelector('[data-testid="fla-c03-workbench"]');
      const rangeInput = document.querySelector('[data-testid="fla-frame-sequence-start"]');
      const action = document.querySelector('[data-testid="fla-frame-sequence-rerender"]') ??
        document.querySelector('[data-testid="fla-frame-sequence-render"]');
      const filmstripItem = document.querySelector('[data-testid="fla-frame-sequence-filmstrip"] button');
      const visible = (element) => {
        if (!(element instanceof Element)) return { visible: false, rect: null, visibleRect: null, clippedBy: [] };
        const rect = element.getBoundingClientRect();
        let visibleRect = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        const clippedBy = [];
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === 'contents') {
            if (ancestor === document.documentElement) break;
            continue;
          }
          const ancestorRect = ancestor.getBoundingClientRect();
          const clipsX = ['auto', 'clip', 'hidden', 'scroll'].includes(style.overflowX);
          const clipsY = ['auto', 'clip', 'hidden', 'scroll'].includes(style.overflowY);
          if (clipsX || clipsY) {
            const previousRect = { ...visibleRect };
            visibleRect = {
              left: clipsX ? Math.max(visibleRect.left, ancestorRect.left) : visibleRect.left,
              right: clipsX ? Math.min(visibleRect.right, ancestorRect.right) : visibleRect.right,
              top: clipsY ? Math.max(visibleRect.top, ancestorRect.top) : visibleRect.top,
              bottom: clipsY ? Math.min(visibleRect.bottom, ancestorRect.bottom) : visibleRect.bottom,
            };
            if (visibleRect.left !== previousRect.left || visibleRect.right !== previousRect.right ||
              visibleRect.top !== previousRect.top || visibleRect.bottom !== previousRect.bottom) {
              clippedBy.push({
                tag: ancestor.tagName,
                className: typeof ancestor.className === 'string' ? ancestor.className : '',
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                rect: { left: ancestorRect.left, top: ancestorRect.top, right: ancestorRect.right,
                  bottom: ancestorRect.bottom },
              });
            }
          }
          if (ancestor === document.documentElement) break;
        }
        visibleRect = {
          left: Math.max(visibleRect.left, 0),
          right: Math.min(visibleRect.right, window.innerWidth),
          top: Math.max(visibleRect.top, 0),
          bottom: Math.min(visibleRect.bottom, window.innerHeight),
        };
        return {
          visible: Boolean(workbench && rect.width > 0 && rect.height > 0 &&
            visibleRect.right - visibleRect.left >= rect.width - 1 &&
            visibleRect.bottom - visibleRect.top >= rect.height - 1),
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            width: rect.width, height: rect.height },
          visibleRect,
          clippedBy,
        };
      };
      const size = (element) => {
        const rect = element?.getBoundingClientRect();
        return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
      };
      return {
        workbenchScrollTop: workbench instanceof HTMLElement ? workbench.scrollTop : 0,
        rangeInputVisible: visible(rangeInput).visible,
        actionVisible: visible(action).visible,
        filmstripItemVisible: visible(filmstripItem).visible,
        rangeInputSize: size(rangeInput),
        actionSize: size(action),
        filmstripItemSize: size(filmstripItem),
        visibilityDiagnostics: {
          rangeInput: visible(rangeInput),
          action: visible(action),
          filmstripItem: visible(filmstripItem),
        },
      };
    });
    runtime.screenshots.sequenceGeneratedNarrowControls = await capture(
      window,
      'sequence-generated-narrow-controls',
    );
    const touch = runtime.layout.sequenceGeneratedNarrowTouch;
    const access = runtime.layout.sequenceGeneratedNarrowReachability;
    assert(touch?.touchStartCount > 0 && touch.touchMoveCount > 0 && touch.scrollTopAfter > touch.scrollTopBefore,
      'A native touch gesture did not scroll the narrow generated-sequence preview.');
    assert(access?.rangeInputVisible && access.actionVisible && access.filmstripItemVisible &&
      access.rangeInputSize.width >= 44 && access.rangeInputSize.height >= 44 &&
      access.actionSize.width >= 44 && access.actionSize.height >= 44 &&
      access.filmstripItemSize.width >= 44 && access.filmstripItemSize.height >= 44,
    'Range, regenerate, and filmstrip controls were not touch reachable in the narrow generated-sequence view: ' +
      JSON.stringify(access));
    runtime.assertions.sequenceNarrowTouchAccess = true;
    if (!runtime.g007Baseline) await verifySequence560CssBreakpointSimulation(window);
  } finally {
    window.setBounds(bounds);
    await delay(300);
  }
}

async function verifySequence(window) {
  const target = findLongSequenceEntry();
  assert(target, 'No supported real target with at least 26 frames was available for range evidence.');
  runtime.layout.sequenceCandidate = {
    targetId: target.targetId,
    label: target.userLabel,
    sourceLibraryItemName: target.sourceLibraryItemName,
    frameCount: target.frameCount,
  };
  await focusCandidate(window, 'sequence', target.targetId);
  await waitForSelector(window, '[data-testid="fla-frame-sequence-range"]');
  const initial = await inPage(window, () => ({
    start: document.querySelector('[data-testid="fla-frame-sequence-start"]')?.value ?? null,
    preview: Boolean(document.querySelector('[data-testid="fla-frame-sequence-preview-image"]')),
    summary: document.querySelector('[data-testid="fla-frame-sequence-range-summary"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    startName: document.querySelector('[data-testid="fla-frame-sequence-start"]')?.getAttribute('aria-label') ?? '',
    layout: (() => {
      const canvas = document.querySelector('[data-testid="fla-frame-sequence-preview-area"]');
      const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
      const input = document.querySelector('[data-testid="fla-frame-sequence-start"]');
      const summary = document.querySelector('[data-testid="fla-frame-sequence-range-summary"]');
      const actions = document.querySelector('.fla-c03-sequence-actions');
      const rect = (element) => {
        if (!(element instanceof Element)) return null;
        const value = element.getBoundingClientRect();
        return { top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const canvasRect = rect(canvas);
      const rangeRect = rect(range);
      const rowTops = [input, summary, actions].filter((element) => element instanceof Element)
        .map((element) => element.getBoundingClientRect().top);
      return {
        canvas: canvasRect,
        range: rangeRect,
        rangeOutsideCanvas: Boolean(range && !range.closest('.fla-c03-preview-stage')),
        rangeBelowCanvas: Boolean(rangeRect && canvasRect && rangeRect.top >= canvasRect.bottom - 1),
        oneRow: rowTops.length === 3 && Math.max(...rowTops) - Math.min(...rowTops) <= 18,
      };
    })(),
  }));
  assert(initial.start === '1' && runtime.sequenceRenders.length === 0 && !initial.preview,
    'Focusing a sequence did not start at frame 1 without rendering.');
  const initialLayoutPass = initial.summary === '第 1–24 帧 · 共 24 帧' && initial.startName === '起始帧' &&
    initial.layout.rangeOutsideCanvas && initial.layout.rangeBelowCanvas && initial.layout.oneRow;
  runtime.layout.sequenceBeforeGeneration = initial.layout;
  runtime.assertions.sequenceControlsSeparatedFromCanvas = initialLayoutPass;
  runtime.assertions.sequenceDefaultRangeSummaryCorrect = initial.summary === '第 1–24 帧 · 共 24 帧';
  if (!runtime.g007Baseline) {
    assert(initialLayoutPass,
      'The initial range controls were not a compact, accessible row below the canvas: ' + JSON.stringify(initial));
  }
  runtime.screenshots.sequenceBeforeGeneration = await capture(window, 'sequence-before-generation');
  runtime.assertions.sequenceFocusDoesNotRender = true;
  const firstCount = Math.min(target.frameCount, 24);
  const first = await renderSequenceRange(
    window,
    target,
    1,
    firstCount,
    'sequence-start-1',
    runtime.g007Only ? 'keyboard-space' : 'keyboard',
  );
  assert(first.range.endFrameIndex - first.range.startFrameIndex + 1 === 24,
    'A sequence range starting at frame 1 did not reach the 24-frame cap.');
  runtime.assertions.sequenceStartsAtOneAndCapsAt24 = true;
  const sequenceVisual = await inPage(window, () => {
    const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
    const rangeCap = range?.querySelector('.fla-frame-sequence-range-cap');
    const actionButton = range?.querySelector(
      '[data-testid="fla-frame-sequence-render"], [data-testid="fla-frame-sequence-rerender"]',
    );
    const preview = document.querySelector('[data-testid="fla-frame-sequence-preview-area"]');
    const filmstrip = document.querySelector('[data-testid="fla-frame-sequence-filmstrip-region"]');
    const summary = document.querySelector('[data-testid="fla-frame-sequence-range-summary"]');
    const input = document.querySelector('[data-testid="fla-frame-sequence-start"]');
    const actions = document.querySelector('.fla-c03-sequence-actions');
    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const value = element.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    const luminance = (color) => {
      const channels = color.match(/[0-9.]+/gu)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) return null;
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (foreground, background) => {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      if (foregroundLuminance === null || backgroundLuminance === null) return null;
      const values = [foregroundLuminance, backgroundLuminance].sort((left, right) => right - left);
      return Number(((values[0] + 0.05) / (values[1] + 0.05)).toFixed(2));
    };
    const rangeStyle = range ? getComputedStyle(range) : null;
    const capStyle = rangeCap ? getComputedStyle(rangeCap) : null;
    const buttonStyle = actionButton ? getComputedStyle(actionButton) : null;
    const panel = document.querySelector('[data-testid="fla-c03-preview"]');
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const rangeRect = rect(range);
    const previewRect = rect(preview);
    const filmstripRect = rect(filmstrip);
    const rowTops = [input, summary, actions].filter((element) => element instanceof Element)
      .map((element) => element.getBoundingClientRect().top);
    return {
      range: rangeRect,
      preview: previewRect,
      filmstrip: filmstripRect,
      rangeOutsideCanvas: Boolean(range && !range.closest('.fla-c03-preview-stage')),
      rangeBelowCanvas: Boolean(rangeRect && previewRect && rangeRect.top >= previewRect.bottom - 1),
      filmstripBelowRange: Boolean(filmstripRect && rangeRect && filmstripRect.top >= rangeRect.bottom - 1),
      controlsOneRow: rowTops.length === 3 && Math.max(...rowTops) - Math.min(...rowTops) <= 18,
      rangeSummary: summary?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      canvasBackgroundImage: preview ? getComputedStyle(preview).backgroundImage : '',
      rangeBackground: rangeStyle?.backgroundColor ?? '',
      capColor: capStyle?.color ?? '',
      capContrast: panelStyle && capStyle ? contrast(capStyle.color, panelStyle.backgroundColor) : null,
      renderBackground: buttonStyle?.backgroundColor ?? '',
      renderColor: buttonStyle?.color ?? '',
      renderContrast: buttonStyle ? contrast(buttonStyle.color, buttonStyle.backgroundColor) : null,
    };
  });
  runtime.layout.sequenceVisual = sequenceVisual;
  const sequenceVisualPass = sequenceVisual.range?.height > 0 && sequenceVisual.range.height <= 180 &&
    sequenceVisual.preview?.height > 0 && sequenceVisual.capContrast >= 4.5 && sequenceVisual.renderContrast >= 4.5;
  const sequenceLayoutPass = sequenceVisual.rangeOutsideCanvas && sequenceVisual.rangeBelowCanvas &&
    sequenceVisual.filmstripBelowRange && sequenceVisual.controlsOneRow &&
    sequenceVisual.preview?.height >= 210 && sequenceVisual.rangeSummary === '第 1–24 帧 · 共 24 帧' &&
    sequenceVisual.canvasBackgroundImage !== 'none';
  if (!runtime.g007Baseline) {
    assert(sequenceVisualPass && sequenceLayoutPass,
      `The sequence canvas and controls were not separated, compact, and readable: ${JSON.stringify(sequenceVisual)}.`);
  } else {
    assert(sequenceVisualPass,
      `The baseline sequence view did not expose readable image and range evidence: ${JSON.stringify(sequenceVisual)}.`);
  }
  runtime.assertions.sequencePanelCompactAndAccessibleContrast = sequenceVisualPass;

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
  await click(window, '[aria-label="恢复默认预览大小"]');
  await waitForPage(window, () => {
    const image = document.querySelector('[data-testid="fla-frame-sequence-preview-image"]');
    const grid = document.querySelector('[data-testid="fla-c03-preview-stage"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 &&
      Number.parseFloat(getComputedStyle(grid).getPropertyValue('--fla-c03-zoom')) === 1;
  });
  const generatedPreview = await readGeneratedSequencePreview(window);
  runtime.layout.sequenceGeneratedPreviewFit = generatedPreview;
  assert(generatedPreview.preview?.height >= 210 && generatedPreview.range?.height <= 125 &&
    generatedPreview.preview.height >= generatedPreview.range.height * 1.5,
  'The generated-sequence main preview did not remain dominant over the frame range at fit zoom: ' +
    JSON.stringify(generatedPreview));
  assert(generatedPreview.imageLoaded && generatedPreview.objectFit === 'contain' &&
    generatedPreview.zoom === 1 && generatedPreview.transformScale.x >= 0.99 && generatedPreview.transformScale.x <= 1.01 &&
    generatedPreview.transformScale.y >= 0.99 && generatedPreview.transformScale.y <= 1.01 &&
    generatedPreview.alphaBounds?.width > 0 && generatedPreview.alphaBounds?.height > 0 &&
    generatedPreview.pixelReadError === null && generatedPreview.visibleContentRatio >= 0.99 &&
    generatedPreview.contentHeightRatio >= 0.65,
  'The actual generated frame pixels were not fully visible in the fit preview: ' + JSON.stringify(generatedPreview));
  runtime.assertions.sequenceGeneratedPreviewShowsFullFrameAtFit = true;
  runtime.screenshots.sequenceGeneratedFitNormal = await capture(window, 'sequence-generated-fit-normal');
  await captureGeneratedSequenceNarrow(window);

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
  const checkedA = await readCandidateFacts(window);
  assert(checkedA.selectedCount === 1 && checkedA.rows.some((row) => row.kind === 'sequence' && row.checked &&
    row.identity?.includes(target.targetId)), 'The rendered sequence could not be checked before the A→B→A preview path.');
  const alternate = findCatalogEntry((entry) =>
    entry.targetId !== target.targetId && entry.previewSupported && !entry.isBlank &&
    entry.selectedFrameIndex === 0,
  );
  assert(alternate, 'Could not find a second previewable candidate for the A→B→A selection path.');
  await focusCandidate(window, 'snapshot', alternate.targetId, 0);
  await waitForCandidatePreview(window, alternate.targetId);
  const ordinaryPreview = await inPage(window, () => {
    const preview = document.querySelector('[data-testid="fla-c03-preview"]');
    const stage = document.querySelector('[data-testid="fla-c03-preview-stage"]');
    const image = document.querySelector('[data-testid="fla-snapshot-preview-image"]');
    const sequenceSlot = document.querySelector('[data-testid="fla-c03-sequence-preview-slot"]');
    const sequenceRange = document.querySelector('[data-testid="fla-frame-sequence-range"]');
    const stageRect = stage?.getBoundingClientRect();
    const rangeRect = sequenceRange?.getBoundingClientRect();
    return {
      candidateKind: preview?.getAttribute('data-candidate-kind') ?? null,
      sequenceCanvas: preview?.getAttribute('data-sequence-canvas') ?? null,
      sequencePreview: preview?.getAttribute('data-sequence-preview') ?? null,
      snapshotTargetId: image?.getAttribute('data-render-target-id') ?? null,
      snapshotImageLoaded: image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      canvasStageDisplay: stage instanceof HTMLElement ? getComputedStyle(stage).display : null,
      sequenceSlotHidden: sequenceSlot instanceof HTMLElement ? sequenceSlot.hidden : null,
      sequenceControlsOutsideCanvas: Boolean(sequenceRange && stage && !stage.contains(sequenceRange)),
      sequenceRangeBelowCanvas: Boolean(stageRect && rangeRect && rangeRect.top >= stageRect.bottom - 1),
    };
  });
  runtime.layout.g007OrdinaryPreview = ordinaryPreview;
  runtime.screenshots.g007OrdinaryPreview = await capture(window, 'g007-snapshot-focus-with-sequence-controls');
  assert(ordinaryPreview.candidateKind === 'snapshot' && ordinaryPreview.sequenceCanvas === 'false' &&
    ordinaryPreview.sequencePreview === 'true' && ordinaryPreview.snapshotTargetId === alternate.targetId &&
    ordinaryPreview.snapshotImageLoaded && ordinaryPreview.canvasStageDisplay !== 'none' &&
    ordinaryPreview.sequenceSlotHidden === false && ordinaryPreview.sequenceControlsOutsideCanvas &&
    ordinaryPreview.sequenceRangeBelowCanvas,
  'The ordinary snapshot preview was affected by the G007 sequence layout: ' + JSON.stringify(ordinaryPreview));
  runtime.assertions.g007OrdinaryPreviewUnaffected = true;
  const selectedB = await readCandidateFacts(window);
  assert(selectedB.selectedCount === 1 && selectedB.rows.some((row) => row.kind === 'sequence' && row.checked &&
    row.identity?.includes(target.targetId)), 'Preview-only focus on sequence B cleared the checked sequence A.');
  await focusCandidate(window, 'sequence', target.targetId);
  await waitForPage(window, (targetId) =>
    document.querySelector('[data-testid="fla-frame-sequence-details-region"]')?.getAttribute('data-focused-target-id') === targetId,
  [target.targetId]);
  const selectedAAgain = await readCandidateFacts(window);
  assert(selectedAAgain.selectedCount === 1 && selectedAAgain.rows.some((row) => row.kind === 'sequence' && row.checked &&
    row.identity?.includes(target.targetId)), 'Returning A→B→A did not retain the checked sequence A.');
  runtime.assertions.sequenceAtoBtoARetainsCheck = true;
  runtime.layout.sequenceAtoBtoA = {
    targetA: target.targetId,
    targetB: alternate.targetId,
    targetBKind: 'snapshot',
    checkedCountAtA: checkedA.selectedCount,
    checkedCountAtB: selectedB.selectedCount,
    checkedCountOnReturnToA: selectedAAgain.selectedCount,
    checkedSequenceIdentity: selectedAAgain.rows.find((row) => row.kind === 'sequence' && row.checked)?.identity ?? null,
  };
  await click(window, '[data-testid="fla-c03-clear-selection"]');
  await waitForPage(window, () =>
    document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length === 0,
  );
  runtime.assertions.sequenceScenarioSelectionCleared = true;

  await setInput(window, '[data-testid="fla-frame-sequence-start"]', '1');
  const beforeCancellation = runtime.sequenceRenders.length;
  if (runtime.g007Only && !runtime.g007Baseline) {
    await waitForPage(window, () => {
      const button = document.querySelector('[data-testid="fla-frame-sequence-render"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    }, [], 120_000);
    await inPage(window, () => document.querySelector('[data-testid="fla-frame-sequence-start"]')?.focus());
    await sendInputKey(window, 'Tab');
    const focus = await inPage(window, () => ({
      focused: document.activeElement === document.querySelector('[data-testid="fla-frame-sequence-render"]'),
      enabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled === false,
    }));
    assert(focus.focused && focus.enabled,
      'Tab did not reach the enabled sequence action for the Enter/cancel scenario: ' + JSON.stringify(focus));
    await sendInputKey(window, 'Enter');
    await waitForPage(window, () =>
      document.querySelector('[data-testid="fla-frame-sequence-preview-status"]')?.dataset.previewState === 'rendering',
    [], 15_000);
    runtime.assertions.sequenceEnterActivatesOperation = true;
  } else {
    // The before-layout capture intentionally runs the old UI, which predates
    // the Enter handler being verified by the after-layout G007 run.
    await click(window, '[data-testid="fla-frame-sequence-render"]');
  }
  await waitForSelector(window, '[data-testid="fla-frame-sequence-progress"]', 120_000);
  const inProgress = await inPage(window, () => ({
    progress: document.querySelector('[data-testid="fla-frame-sequence-progress"]')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    cancelVisible: Boolean(document.querySelector('[data-testid="fla-frame-sequence-cancel"]')),
    rangeOutsideCanvas: Boolean(document.querySelector('[data-testid="fla-frame-sequence-range"]') &&
      !document.querySelector('[data-testid="fla-frame-sequence-range"]')?.closest('.fla-c03-preview-stage')),
  }));
  assert(/^正在生成 \d+ \/ 24$/u.test(inProgress.progress) && inProgress.cancelVisible &&
    (runtime.g007Baseline || inProgress.rangeOutsideCanvas),
    'Real X/N progress and cancellation were not reachable in the detached operation row: ' + JSON.stringify(inProgress));
  runtime.layout.sequenceCancellationProgress = inProgress;
  runtime.screenshots.sequenceCancellationInProgress = await capture(window, 'sequence-cancellation-in-progress');
  await click(window, '[data-testid="fla-frame-sequence-cancel"]');
  await waitForPage(window, () =>
    document.querySelector('[data-testid="fla-frame-sequence-preview-status"]')?.textContent?.includes('已取消') === true &&
    !document.querySelector('[data-testid="fla-frame-sequence-progress"]'),
  [], 120_000);
  const cancellationDeadline = Date.now() + 30_000;
  while (runtime.sequenceRenders.length === beforeCancellation && Date.now() < cancellationDeadline) await delay(50);
  const cancelledRequest = runtime.sequenceRenders.at(-1);
  assert(runtime.sequenceRenders.length === beforeCancellation + 1 && cancelledRequest?.ok === false &&
    cancelledRequest.errorCode === 'SEQUENCE_CANCELLED' && cancelledRequest.frameCount < 24,
  'Cancelling the real sequence operation did not stop before all 24 frames completed: ' + JSON.stringify(cancelledRequest));
  runtime.assertions.sequenceCancellationStopsRender = true;
  runtime.screenshots.sequenceCancelled = await capture(window, 'sequence-cancelled');
}

async function verifyResponsiveAndTouch(window, bluehairTargetId) {
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

  const mouseSelection = await mouseClickCandidateCheckbox(window, bluehairTargetId);
  runtime.layout.mouseCheckboxFocus = mouseSelection;
  assert(mouseSelection.checked && mouseSelection.focused && mouseSelection.selectedCount === 1 &&
    mouseSelection.hitboxWidth >= 48 && mouseSelection.hitboxHeight >= 48 &&
    (mouseSelection.outlineStyle === 'none' || mouseSelection.outlineWidth === 0),
  'A real mouse click must select the candidate without a redundant checkbox outline: ' + JSON.stringify(mouseSelection));
  runtime.assertions.mouseFocusDoesNotShowRedundantOutline = true;
  runtime.screenshots.mouseSelectedCheckbox = await capture(window, 'mouse-selected-checkbox');

  const toolbarNormal = await inPage(window, () => {
    const toolbar = document.querySelector('.fla-c03-browser-tools');
    const toolbarRect = toolbar?.getBoundingClientRect();
    const elements = toolbar
      ? [...toolbar.children].filter((child) => child.matches('.fla-c03-search, button'))
      : [];
    const rects = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.matches('.fla-c03-search')
          ? 'search'
          : element.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    const tops = rects.map((rect) => rect.top);
    const oneRow = tops.length === 4 && Math.max(...tops) - Math.min(...tops) <= 1;
    const inside = Boolean(toolbarRect) && rects.every((rect) =>
      rect.left >= toolbarRect.left - 1 && rect.right <= toolbarRect.right + 1 && rect.height >= 44,
    );
    let overlap = false;
    for (let first = 0; first < rects.length; first += 1) {
      for (let second = first + 1; second < rects.length; second += 1) {
        const a = rects[first];
        const b = rects[second];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          overlap = true;
        }
      }
    }
    return {
      viewportWidth: window.innerWidth,
      toolbarWidth: toolbarRect?.width ?? 0,
      oneRow,
      inside,
      overlap,
      controls: rects,
      selectedLabel: toolbar?.querySelector('[data-testid="fla-c03-selected-view"]')?.textContent?.trim() ?? '',
    };
  });
  runtime.layout.toolbarNormal = toolbarNormal;
  assert(toolbarNormal.oneRow && toolbarNormal.inside && !toolbarNormal.overlap && toolbarNormal.selectedLabel === '已选 1',
    'The normal-width toolbar did not keep its compact controls on one visible row: ' + JSON.stringify(toolbarNormal));
  runtime.assertions.toolbarOneRowNormal = true;

  const controls = await inPage(window, () => {
    const close = document.querySelector('[data-testid="fla-review-cancel"]');
    const closeRect = close?.getBoundingClientRect();
    const zoom = [...document.querySelectorAll('.fla-c03-zoom-tools button')];
    const zoomRect = zoom.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.getAttribute('aria-label'),
        text: button.textContent?.trim() ?? '',
        fontSize: Number.parseFloat(getComputedStyle(button).fontSize),
        width: rect.width,
        height: rect.height,
        title: button.getAttribute('title'),
      };
    });
    const primary = document.querySelector('[data-testid="fla-unified-import"]');
    const primaryRect = primary?.getBoundingClientRect();
    return {
      close: {
        name: close?.getAttribute('aria-label') ?? '',
        text: close?.textContent?.trim() ?? '',
        width: closeRect?.width ?? 0,
        height: closeRect?.height ?? 0,
      },
      zoom: zoomRect,
      primary: {
        text: primary?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
        disabled: primary?.disabled ?? true,
        fontSize: primary ? Number.parseFloat(getComputedStyle(primary).fontSize) : 0,
        fontWeight: primary ? Number.parseInt(getComputedStyle(primary).fontWeight, 10) : 0,
        textAlign: primary ? getComputedStyle(primary).textAlign : '',
        width: primaryRect?.width ?? 0,
        height: primaryRect?.height ?? 0,
        scrollWidth: primary?.scrollWidth ?? 0,
        clientWidth: primary?.clientWidth ?? 0,
        scrollHeight: primary?.scrollHeight ?? 0,
        clientHeight: primary?.clientHeight ?? 0,
      },
    };
  });
  runtime.layout.visibleControls = controls;
  assert(controls.close.name === '关闭' && controls.close.text === '×' &&
    controls.close.width >= 48 && controls.close.height >= 48,
  'The internal close icon lost its accessible name or 48 CSS-pixel hitbox: ' + JSON.stringify(controls.close));
  runtime.assertions.closeIconAccessibleAndReachable = true;
  const zoomMinus = controls.zoom.find((button) => button.name === '缩小预览');
  const zoomReset = controls.zoom.find((button) => button.name === '恢复默认预览大小');
  const zoomPlus = controls.zoom.find((button) => button.name === '放大预览');
  assert(zoomMinus?.text === '−' && zoomPlus?.text === '+' &&
    zoomMinus.fontSize >= 20 && zoomPlus.fontSize >= 20 &&
    zoomReset?.text === '适中' && zoomReset.title === '恢复默认预览大小',
  'The zoom controls do not expose the requested centered symbols, label, and reset explanation: ' + JSON.stringify(controls.zoom));

  await click(window, '[aria-label="放大预览"]');
  await waitForPage(window, () => Number.parseFloat(
    getComputedStyle(document.querySelector('[data-testid="fla-c03-preview-stage"]'))
      .getPropertyValue('--fla-c03-zoom'),
  ) === 1.25);
  await click(window, '[aria-label="缩小预览"]');
  await waitForPage(window, () => Number.parseFloat(
    getComputedStyle(document.querySelector('[data-testid="fla-c03-preview-stage"]'))
      .getPropertyValue('--fla-c03-zoom'),
  ) === 1);
  await click(window, '[aria-label="放大预览"]');
  await click(window, '[aria-label="恢复默认预览大小"]');
  await waitForPage(window, () => Number.parseFloat(
    getComputedStyle(document.querySelector('[data-testid="fla-c03-preview-stage"]'))
      .getPropertyValue('--fla-c03-zoom'),
  ) === 1);
  runtime.assertions.zoomControlsKeepDefaultReset = true;

  assert(controls.primary.text === '导入 1 项' && !controls.primary.disabled &&
    controls.primary.fontSize >= 16 && controls.primary.fontWeight >= 700 &&
    controls.primary.textAlign === 'center' && controls.primary.scrollWidth <= controls.primary.clientWidth + 1 &&
    controls.primary.scrollHeight <= controls.primary.clientHeight + 1,
  'The selected-count import action is not centered, visible, or operable: ' + JSON.stringify(controls.primary));
  runtime.assertions.importButtonHasVisibleCount = true;

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
  const toolbarNarrow = await inPage(window, () => {
    const toolbar = document.querySelector('.fla-c03-browser-tools');
    const toolbarRect = toolbar?.getBoundingClientRect();
    const elements = toolbar
      ? [...toolbar.children].filter((child) => child.matches('.fla-c03-search, button'))
      : [];
    const controls = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.matches('.fla-c03-search') ? 'search' : element.textContent?.trim() ?? '',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    let overlap = false;
    for (let first = 0; first < controls.length; first += 1) {
      for (let second = first + 1; second < controls.length; second += 1) {
        const a = controls[first];
        const b = controls[second];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          overlap = true;
        }
      }
    }
    return {
      toolbarWidth: toolbarRect?.width ?? 0,
      inside: Boolean(toolbarRect) && controls.every((rect) =>
        rect.left >= toolbarRect.left - 1 && rect.right <= toolbarRect.right + 1 && rect.height >= 44,
      ),
      overlap,
      controls,
    };
  });
  runtime.layout.toolbarNarrow = toolbarNarrow;
  assert(toolbarNarrow.inside && !toolbarNarrow.overlap,
    'The compact toolbar became clipped or overlapped at the narrow window size: ' + JSON.stringify(toolbarNarrow));
  runtime.assertions.toolbarReachableNarrow = true;
  runtime.screenshots.narrow = await capture(window, 'c03-narrow');
  await click(window, '[data-testid="fla-c03-clear-selection"]');
  await waitForPage(window, () =>
    document.querySelectorAll('.fla-c03-candidate input[type="checkbox"]:checked').length === 0,
  );
  window.setBounds(bounds);
  await delay(300);
}

async function readImportReceipt(window) {
  return inPage(window, () => {
    const root = document.querySelector('[data-testid="fla-unified-import-receipt"]');
    const list = document.querySelector('[data-testid="fla-unified-import-items"]');
    const diagnostics = document.querySelector('[data-testid="fla-unified-import-diagnostics"]');
    const guidance = document.querySelector('[data-testid="fla-unified-import-review-guidance"]');
    const items = [...(list?.querySelectorAll('li') ?? [])].map((item) => ({
      kind: item.dataset.kind,
      status: item.dataset.status,
      label: item.querySelector('strong')?.textContent?.trim() ?? '',
    }));
    return {
      partial: root?.dataset.partial === 'true',
      cancelled: Boolean(document.querySelector('[data-testid="fla-unified-import-cancelled"]')),
      summary: root?.querySelector(':scope > summary')?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      guidance: guidance?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      visibleText: root?.innerText?.replace(/\s+/gu, ' ').trim() ?? '',
      diagnosticsPresent: diagnostics instanceof HTMLDetailsElement,
      diagnosticsCollapsed: diagnostics instanceof HTMLDetailsElement && !diagnostics.open,
      diagnosticsText: diagnostics?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      items,
      text: root?.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
    };
  });
}

async function readReceiptReachability(window) {
  return inPage(window, () => {
    const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
    const action = document.querySelector('[data-testid="fla-unified-import"]');
    const receipt = document.querySelector('[data-testid="fla-unified-import-receipt"]');
    const summary = receipt?.querySelector(':scope > summary');
    const items = [...(receipt?.querySelectorAll('[data-testid="fla-unified-import-items"] li') ?? [])];
    const rect = (element) => {
      if (!(element instanceof Element)) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const visibleInFooter = (element) => {
      const elementRect = rect(element);
      const footerRect = rect(footer);
      return Boolean(elementRect && footerRect && elementRect.width > 0 && elementRect.height > 0 &&
        elementRect.top >= Math.max(0, footerRect.top) - 1 && elementRect.bottom <= Math.min(window.innerHeight, footerRect.bottom) + 1 &&
        elementRect.left >= Math.max(0, footerRect.left) - 1 && elementRect.right <= Math.min(window.innerWidth, footerRect.right) + 1);
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      footerVisible: visibleInFooter(footer),
      actionVisible: visibleInFooter(action),
      summaryVisible: visibleInFooter(summary),
      firstItemVisible: visibleInFooter(items[0]),
      lastItemVisible: visibleInFooter(items.at(-1)),
      footer: {
        scrollTop: footer instanceof HTMLElement ? footer.scrollTop : 0,
        scrollHeight: footer instanceof HTMLElement ? footer.scrollHeight : 0,
        clientHeight: footer instanceof HTMLElement ? footer.clientHeight : 0,
      },
    };
  });
}

async function touchScrollReceipt(window, marker) {
  const point = await inPage(window, (touchMarker) => {
    const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
    const receipt = document.querySelector('[data-testid="fla-unified-import-receipt"]');
    const target = receipt?.querySelector('[data-testid="fla-unified-import-items"] li') ??
      receipt?.querySelector(':scope > summary') ?? receipt;
    if (!(footer instanceof HTMLElement) || !(target instanceof Element)) return null;
    const footerRect = footer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const y = Math.max(footerRect.top + 12, Math.min(footerRect.bottom - 12,
      targetRect.top + Math.min(targetRect.height / 2, 24)));
    const x = Math.max(1, Math.min(window.innerWidth - 1, footerRect.left + footerRect.width / 2));
    const state = { touchStartCount: 0, touchMoveCount: 0, scrollTopBefore: footer.scrollTop };
    const onTouchStart = (event) => { if (footer.contains(event.target)) state.touchStartCount += 1; };
    const onTouchMove = (event) => { if (footer.contains(event.target)) state.touchMoveCount += 1; };
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    window.__issue778PartialReceiptTouch = { touchMarker, state, footer, onTouchStart, onTouchMove };
    return { x, y, deltaY: 110 };
  }, marker);
  assert(point, 'Partial-failure receipt did not expose a native touch target.');

  const debuggerApi = window.webContents.debugger;
  const attachedHere = !debuggerApi.isAttached();
  if (attachedHere) debuggerApi.attach('1.3');
  try {
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(40);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: point.x, y: point.y - point.deltaY, radiusX: 1, radiusY: 1, force: 1 }],
    });
    await delay(80);
    await debuggerApi.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach();
  }
  await delay(120);
  return inPage(window, (touchMarker) => {
    const touch = window.__issue778PartialReceiptTouch;
    if (!touch || touch.touchMarker !== touchMarker) return null;
    document.removeEventListener('touchstart', touch.onTouchStart);
    document.removeEventListener('touchmove', touch.onTouchMove);
    return {
      dispatchedBy: 'Electron CDP Input.dispatchTouchEvent',
      touchStartCount: touch.state.touchStartCount,
      touchMoveCount: touch.state.touchMoveCount,
      scrollTopBefore: touch.state.scrollTopBefore,
      scrollTopAfter: touch.footer.scrollTop,
      scrollHeight: touch.footer.scrollHeight,
      clientHeight: touch.footer.clientHeight,
    };
  }, marker);
}

async function verifyPartialReceiptKeyboardPath(window, viewportName) {
  const start = await inPage(window, () => {
    const preview = document.querySelector('[data-testid="fla-c03-preview"]');
    if (!(preview instanceof HTMLElement)) return null;
    const focusables = [...preview.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]')]
      .filter((element) => element instanceof HTMLElement && element.tabIndex >= 0 &&
        !('disabled' in element && element.disabled) && element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden');
    const last = focusables.at(-1);
    if (!(last instanceof HTMLElement)) return null;
    last.focus();
    return {
      tagName: last.tagName,
      ariaLabel: last.getAttribute('aria-label'),
      testId: last.getAttribute('data-testid'),
    };
  });
  assert(start, `No visible preview control was available before the ${viewportName} receipt keyboard path.`);

  const actionDisabled = await inPage(window, () =>
    document.querySelector('[data-testid="fla-unified-import"]')?.disabled ?? true,
  );
  await sendInputKey(window, 'Tab');
  const firstTab = await inPage(window, () => {
    const action = document.querySelector('[data-testid="fla-unified-import"]');
    const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
    const receipt = document.querySelector('[data-testid="fla-unified-import-receipt"]');
    const summary = receipt?.querySelector(':scope > summary');
    const rect = action?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return {
      importFocused: document.activeElement === action,
      importVisible: Boolean(rect && footerRect && rect.height > 0 && rect.top >= Math.max(0, footerRect.top) - 1 &&
        rect.bottom <= Math.min(window.innerHeight, footerRect.bottom) + 1),
      receiptSummaryFocused: document.activeElement === summary,
    };
  });
  let importFocus = null;
  let receiptFocus;
  if (actionDisabled) {
    const receiptState = await inPage(window, () => {
      const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
      const action = document.querySelector('[data-testid="fla-unified-import"]');
      const receipt = document.querySelector('[data-testid="fla-unified-import-receipt"]');
      const summary = receipt?.querySelector(':scope > summary');
      const summaryRect = summary?.getBoundingClientRect();
      const actionRect = action?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const visibleInFooter = (rect) => Boolean(rect && footerRect && rect.height > 0 &&
        rect.top >= Math.max(0, footerRect.top) - 1 && rect.bottom <= Math.min(window.innerHeight, footerRect.bottom) + 1);
      return {
        focused: document.activeElement === summary,
        summaryVisible: visibleInFooter(summaryRect),
        actionVisible: visibleInFooter(actionRect),
      };
    });
    receiptFocus = receiptState;
  } else {
    importFocus = {
      focused: firstTab.importFocused,
      visible: firstTab.importVisible,
    };
    await sendInputKey(window, 'Tab');
    receiptFocus = await inPage(window, () => {
      const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
      const action = document.querySelector('[data-testid="fla-unified-import"]');
      const receipt = document.querySelector('[data-testid="fla-unified-import-receipt"]');
      const summary = receipt?.querySelector(':scope > summary');
      const summaryRect = summary?.getBoundingClientRect();
      const actionRect = action?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const visibleInFooter = (rect) => Boolean(rect && footerRect && rect.height > 0 &&
        rect.top >= Math.max(0, footerRect.top) - 1 && rect.bottom <= Math.min(window.innerHeight, footerRect.bottom) + 1);
      return {
        focused: document.activeElement === summary,
        summaryVisible: visibleInFooter(summaryRect),
        actionVisible: visibleInFooter(actionRect),
      };
    });
  }
  const result = { start, actionDisabled, firstTab, importFocus, receiptFocus };
  assert(actionDisabled
    ? firstTab.receiptSummaryFocused && receiptFocus.focused && receiptFocus.summaryVisible && receiptFocus.actionVisible
    : importFocus?.focused && importFocus.visible && receiptFocus?.focused && receiptFocus.summaryVisible && receiptFocus.actionVisible,
  `Keyboard focus did not reach the visible import/receipt path at ${viewportName}: ${JSON.stringify(result)}.`);
  runtime.layout.partialReceiptKeyboard ??= {};
  runtime.layout.partialReceiptKeyboard[viewportName] = result;
  return result;
}

async function verifyPartialReceiptReachability(window) {
  const originalBounds = window.getBounds();
  const viewports = [
    { name: 'viewport846x653', requested: { width: 860, height: 690 }, expectedWidth: 846, expectedHeight: 653 },
    { name: 'narrowNative', requested: { width: 800, height: 560 }, expectedWidth: null, expectedHeight: null },
  ];
  const results = {};
  try {
    for (const viewport of viewports) {
      window.setBounds({ x: originalBounds.x, y: originalBounds.y, ...viewport.requested });
      await delay(500);
      await inPage(window, () => {
        const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
        if (footer instanceof HTMLElement) footer.scrollTop = 0;
      });
      await delay(100);
      const top = await readReceiptReachability(window);
      runtime.screenshots[`partialFailureReceipt-${viewport.name}-top`] = await capture(
        window,
        `partial-failure-receipt-${viewport.name}-top`,
      );
      const viewportDimensionsMatch = viewport.expectedWidth === null
        ? top.viewport.width < 846 && top.viewport.height < 653
        : top.viewport.width === viewport.expectedWidth && top.viewport.height === viewport.expectedHeight;
      assert(viewportDimensionsMatch && Math.abs(top.viewport.devicePixelRatio - 1.5) < 0.01,
      `The partial-failure receipt did not reach the expected native ${viewport.name} viewport: ${JSON.stringify(top.viewport)}.`);
      assert(top.footer.scrollTop <= 1 && top.footerVisible && top.actionVisible && top.summaryVisible,
        `The partial-failure receipt or import action was not reachable at the top of ${viewport.name}: ${JSON.stringify(top)}.`);

      const touch = await touchScrollReceipt(window, `partial-receipt-${viewport.name}`);
      assert(touch && touch.touchStartCount > 0 && touch.touchMoveCount > 0 &&
        (touch.scrollHeight <= touch.clientHeight + 1 || touch.scrollTopAfter > touch.scrollTopBefore + 1),
      `Native touch did not reach or scroll the partial-failure receipt at ${viewport.name}: ${JSON.stringify(touch)}.`);
      await inPage(window, () => {
        const footer = document.querySelector('[data-testid="fla-c03-import-footer"]');
        if (footer instanceof HTMLElement) footer.scrollTop = footer.scrollHeight;
      });
      await delay(100);
      const bottom = await readReceiptReachability(window);
      runtime.screenshots[`partialFailureReceipt-${viewport.name}-scrolled`] = await capture(
        window,
        `partial-failure-receipt-${viewport.name}-scrolled`,
      );
      assert(bottom.footerVisible && bottom.actionVisible && bottom.lastItemVisible,
        `The last partial-failure receipt item or import action was unreachable at ${viewport.name}: ${JSON.stringify(bottom)}.`);

      const keyboard = await verifyPartialReceiptKeyboardPath(window, viewport.name);
      runtime.screenshots[`partialFailureReceipt-${viewport.name}-keyboard`] = await capture(
        window,
        `partial-failure-receipt-${viewport.name}-keyboard`,
      );
      results[viewport.name] = { top, touch, bottom, keyboard };
    }
  } finally {
    window.setBounds(originalBounds);
    await delay(300);
  }
  runtime.layout.partialFailureReceiptReachability = results;
  runtime.assertions.partialFailureReceiptTouchReachable = true;
  runtime.assertions.partialFailureReceiptKeyboardReachable = true;
  runtime.assertions.partialFailureReceiptReachableAtBothViewports = true;
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
  assert(partialFailure.diagnosticsPresent && partialFailure.diagnosticsCollapsed &&
    partialFailure.summary.includes('部分导入完成') &&
    partialFailure.summary.includes('新导入 1 项') && partialFailure.summary.includes('失败 1 项') &&
    partialFailure.guidance.includes('检查素材库') &&
    !partialFailure.visibleText.includes('Bounded verifier injected'),
  `The partial-failure receipt did not lead with plain-language counts and guidance: ${JSON.stringify({
    summary: partialFailure.summary,
    guidance: partialFailure.guidance,
    diagnosticsPresent: partialFailure.diagnosticsPresent,
    diagnosticsCollapsed: partialFailure.diagnosticsCollapsed,
    visibleText: partialFailure.visibleText,
  })}.`);
  runtime.assertions.receiptGuidanceInPlainLanguage = true;
  runtime.assertions.receiptDiagnosticsCollapsed = true;
  runtime.assertions.partialFailureRetainsFirstCommit = true;
  runtime.screenshots.partialFailureReceipt = await capture(window, 'partial-failure-receipt');
  await verifyPartialReceiptReachability(window);
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

function verifyG007SameSourceComparison() {
  const baselineReceipt = runtime.g007BaselineReceipt?.receipt;
  assert(baselineReceipt, 'A successful same-source baseline receipt is required before G007 comparison.');
  const before = baselineReceipt.layout?.sequenceGeneratedPreviewFit;
  const after = runtime.layout.sequenceGeneratedPreviewFit;
  const beforeCandidate = baselineReceipt.layout?.sequenceCandidate;
  const afterCandidate = runtime.layout.sequenceCandidate;
  const beforeSequence = baselineReceipt.sequenceRenders?.[0];
  const afterSequence = runtime.sequenceRenders[0];
  const beforeWindow = baselineReceipt.layout?.initialWindowBounds;
  const afterWindow = runtime.layout.initialWindowBounds;
  const beforeContent = baselineReceipt.layout?.initialContentBounds;
  const afterContent = runtime.layout.initialContentBounds;
  const beforeScale = baselineReceipt.runtime?.primaryDisplayScaleFactor;
  const afterScale = runtime.layout.displayScaleFactor;
  assert(before && after && beforeCandidate && afterCandidate && beforeSequence && afterSequence,
    'The before/after receipts are missing the generated preview, candidate, or first sequence request.');

  const sameCandidateAndFrameRange = beforeCandidate.targetId === afterCandidate.targetId &&
    beforeSequence.range?.startFrameIndex === afterSequence.range?.startFrameIndex &&
    beforeSequence.range?.endFrameIndex === afterSequence.range?.endFrameIndex &&
    beforeSequence.range?.startFrameIndex === 0 && beforeSequence.range?.endFrameIndex === 23;
  const sameLogicalWindowAndScale = beforeWindow?.width === afterWindow?.width &&
    beforeWindow?.height === afterWindow?.height && beforeContent?.width === afterContent?.width &&
    beforeContent?.height === afterContent?.height && beforeScale === afterScale;
  const displayedHeightRatio = Number((after.displayedContent.height / before.displayedContent.height).toFixed(4));
  const displayedWidthRatio = Number((after.displayedContent.width / before.displayedContent.width).toFixed(4));
  const displayedAreaRatio = Number((displayedHeightRatio * displayedWidthRatio).toFixed(4));
  const previewHeightRatio = Number((after.preview.height / before.preview.height).toFixed(4));
  const noMeaningfulPersonCompression = before.zoom === 1 && after.zoom === 1 &&
    before.visibleContentRatio >= 0.99 && after.visibleContentRatio >= 0.99 &&
    displayedHeightRatio >= 0.9 && displayedWidthRatio >= 0.9 && displayedAreaRatio >= 0.9;
  runtime.layout.g007BeforeAfterComparison = {
    baselineReceiptPath: runtime.g007BaselineReceipt.path,
    baselineRunId: baselineReceipt.runId,
    sameCandidateAndFrameRange,
    sameLogicalWindowAndScale,
    noMeaningfulPersonCompression,
    displayScaleFactor: afterScale,
    before: {
      targetId: beforeCandidate.targetId,
      frameRange: beforeSequence.range,
      windowBounds: beforeWindow,
      contentBounds: beforeContent,
      preview: before.preview,
      displayedPerson: before.displayedContent,
      screenshot: baselineReceipt.screenshots?.['sequence-start-1']?.path ?? null,
    },
    after: {
      targetId: afterCandidate.targetId,
      frameRange: afterSequence.range,
      windowBounds: afterWindow,
      contentBounds: afterContent,
      preview: after.preview,
      displayedPerson: after.displayedContent,
      screenshot: runtime.screenshots['sequence-start-1']?.path ?? null,
    },
    displayedHeightRatio,
    displayedWidthRatio,
    displayedAreaRatio,
    previewHeightRatio,
  };
  runtime.assertions.g007SameCandidateAndFrameRange = sameCandidateAndFrameRange;
  runtime.assertions.g007SameLogicalWindowAndScale = sameLogicalWindowAndScale;
  runtime.assertions.g007PreviewPersonNotCompressed = noMeaningfulPersonCompression;
  assert(sameCandidateAndFrameRange,
    'The before/after screenshots do not use the same real sequence candidate and first 24-frame range.');
  assert(sameLogicalWindowAndScale,
    'The before/after screenshots do not use the same logical window/content bounds and Windows display scale.');
  assert(noMeaningfulPersonCompression,
    'The refactor significantly reduced the displayed person or clipped the character at fit zoom: ' +
    JSON.stringify(runtime.layout.g007BeforeAfterComparison));
}

async function writeReceipt(status, extra = {}) {
  const sourceSha256After = runtime.sourcePath ? sha256File(runtime.sourcePath) : null;
  const primaryDisplay = screen.getPrimaryDisplay();
  const receipt = {
    schemaVersion: runtime.g007Only
      ? 'issue781-g007-windows-electron/1'
      : 'issue775-c03-windows-electron/1',
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
    baseline: runtime.g007Only
      ? (runtime.g007BaselineReceipt ? {
          path: runtime.g007BaselineReceipt.path,
          runId: runtime.g007BaselineReceipt.receipt.runId,
          sourceSha256: runtime.g007BaselineReceipt.receipt.source?.sha256Before ?? null,
          screenshot: runtime.g007BaselineReceipt.receipt.screenshots?.['sequence-start-1']?.path ?? null,
        } : null)
      : {
      path: join(runtime.repositoryRoot, BASELINE_PATH),
      receiptPath: join(runtime.repositoryRoot, BASELINE_RECEIPT_PATH),
      width: runtime.layout.baselineWidth ?? null,
      height: runtime.layout.baselineHeight ?? null,
      windowBounds: BASELINE_WINDOW_BOUNDS,
      sha256: BASELINE_SHA256,
      windowsScalingRecordedInOriginalReceipt: false,
      inferredContentBounds: runtime.layout.baselineContentBoundsInferred ?? null,
      sameContentBoundsAsC03: runtime.assertions.sameContentBoundsAsBaseline === true,
      sameCaptureSizeAsC03: runtime.assertions.sameSizeBeforeAfter === true,
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
      lastStage: runtime.failureStage,
      failureStage: status === 'FAIL' ? runtime.failureStage : null,
      renderer: runtime.rendererDiagnostics,
    },
    assertions: runtime.assertions,
    originalSourceUnchanged: runtime.sourceSha256Before === sourceSha256After,
    limitations: [
      'Automated Windows Electron evidence is not owner human visual acceptance.',
      ...(runtime.g007Only ? [] : [
        'The historical before screenshot has matching pixel dimensions; its receipt did not record the Windows display scale factor.',
        'The historical before receipt records the main-window bounds but not its display scale factor; the C03 comparison matches logical content bounds and capture pixels, while current Windows scaling is recorded directly.',
      ]),
      '125% Windows scaling is reported only when the host exposes a display at that scale; a Chromium forced scale factor is not described as Windows DPI.',
      ...((runtime.layout.displays ?? []).some((display) => Math.abs(display.scaleFactor - 1.25) < 0.01)
        ? []
        : ['This host exposed no 125% Windows display; 125% Windows DPI was not validated in this run.']),
    ],
    ...extra,
  };
  const json = JSON.stringify(receipt, null, 2) + '\n';
  const receiptName = runtime.g007Only ? 'issue781-g007-receipt.json' : 'issue775-c03-receipt.json';
  writeFileSync(join(runtime.runRoot, receiptName), json, 'utf8');
  writeFileSync(join(runtime.evidenceDirectory, 'receipt.json'), json, 'utf8');
  process.stdout.write(JSON.stringify({
    status,
    receiptPath: join(runtime.runRoot, receiptName),
    repoReceiptPath: join(runtime.evidenceDirectory, 'receipt.json'),
  }) + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  runtime.g007Only = Boolean(args.g007Only || args.g007Baseline);
  runtime.g007Baseline = Boolean(args.g007Baseline);
  runtime.acceptanceRoot = resolve(args.acceptanceRoot ?? DEFAULT_ACCEPTANCE_ROOT);
  runtime.runRoot = join(runtime.acceptanceRoot, 'run-' + runtime.runId);
  runtime.userData = join(runtime.runRoot, 'electron-user-data');
  runtime.projectParent = join(runtime.acceptanceRoot, 'projects');
  const evidenceRoot = args.evidenceRoot
    ? resolve(runtime.repositoryRoot, args.evidenceRoot)
    : join(runtime.repositoryRoot, 'docs', 'evidence', 'issue-775-c03');
  runtime.evidenceDirectory = join(evidenceRoot, 'run-' + runtime.runId);
  runtime.sourcePath = args.source ? resolve(args.source) : findSourceFile(DEFAULT_SOURCE_ROOT, SOURCE_FILE_NAME);
  assert(!runtime.g007Only || args.source,
    'G007-only mode requires an explicit --source path to the real FLA under review.');
  for (const directory of [runtime.runRoot, runtime.userData, runtime.projectParent, runtime.evidenceDirectory]) {
    mkdirSync(directory, { recursive: true });
  }

  runtime.sourceSha256Before = sha256File(runtime.sourcePath);
  if (runtime.g007Only && !runtime.g007Baseline) {
    assert(args.baselineReceipt, 'G007 after-layout verification requires --baseline-receipt from a successful same-source baseline run.');
    const baselineReceiptPath = resolve(args.baselineReceipt);
    assert(existsSync(baselineReceiptPath), 'The G007 same-source baseline receipt does not exist.');
    const baselineReceipt = JSON.parse(readFileSync(baselineReceiptPath, 'utf8'));
    assert(baselineReceipt.schemaVersion === 'issue781-g007-windows-electron/1' &&
      baselineReceipt.status === 'PASS' && baselineReceipt.captureRole === 'before-layout-capture' &&
      baselineReceipt.source?.unchanged === true &&
      baselineReceipt.source?.sha256Before === runtime.sourceSha256Before,
    'The G007 baseline receipt does not prove a successful unchanged run on this exact FLA source.');
    runtime.g007BaselineReceipt = { path: baselineReceiptPath, receipt: baselineReceipt };
  }
  if (!runtime.g007Only) {
    const baselinePath = join(runtime.repositoryRoot, BASELINE_PATH);
    assert(existsSync(baselinePath), 'The approved C02 baseline screenshot is missing.');
    const baselineBytes = readFileSync(baselinePath);
    assert(sha256(baselineBytes) === BASELINE_SHA256, 'The historical C02 baseline screenshot changed unexpectedly.');
    runtime.layout.baselineWidth = baselineBytes.readUInt32BE(16);
    runtime.layout.baselineHeight = baselineBytes.readUInt32BE(20);
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
  }

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
  runtime.layout.displayScaleFactor = screen.getDisplayMatching(window.getBounds()).scaleFactor;
  await waitForSelector(window, '[data-testid="new-project-button"]');
  await createProject(window);
  await openFlaWorkbench(window);
  await waitForPreviewGate(window);
  const catalogDeadline = Date.now() + 180_000;
  while (runtime.catalogResponses.length === 0 && Date.now() < catalogDeadline) await delay(100);
  assert(runtime.catalogResponses.length > 0, 'Main did not return a render-target catalog.');

  if (runtime.g007Only) {
    runtime.failureStage = runtime.g007Baseline ? 'capture-g007-before-layout' : 'verify-g007-sequence-layout';
    await waitForSnapshotCatalogScan(window);
    await verifySequence(window);
    if (!runtime.g007Baseline) verifyG007SameSourceComparison();
    const sourceSha256After = sha256File(runtime.sourcePath);
    assert(sourceSha256After === runtime.sourceSha256Before,
      'The original FLA changed during G007 sequence preview verification.');
    runtime.assertions.originalFlaUnchanged = true;
    const requiredAssertions = [
      'sequenceFocusDoesNotRender',
      'sequenceStartsAtOneAndCapsAt24',
      'sequenceOperationKeyboardAccessible',
      'sequenceSpaceActivatesOperation',
      ...(!runtime.g007Baseline ? ['sequenceEnterActivatesOperation'] : []),
      'sequencePanelCompactAndAccessibleContrast',
      'sequenceGeneratedPreviewShowsFullFrameAtFit',
      'sequenceNarrowTouchAccess',
      ...(!runtime.g007Baseline ? ['sequence560CssBreakpointSimulation'] : []),
      'sequenceRangeChangeInvalidatesCheck',
      'sequenceNearEndUsesShortRemainder',
      'sequenceAtoBtoARetainsCheck',
      'sequenceScenarioSelectionCleared',
      'sequenceCancellationStopsRender',
      'originalFlaUnchanged',
      ...(runtime.g007Baseline ? [] : [
        'g007SameCandidateAndFrameRange',
        'g007SameLogicalWindowAndScale',
        'g007PreviewPersonNotCompressed',
      ]),
      ...(runtime.g007Baseline ? [] : [
        'sequenceControlsSeparatedFromCanvas',
        'sequenceDefaultRangeSummaryCorrect',
        'g007OrdinaryPreviewUnaffected',
      ]),
    ];
    const missing = requiredAssertions.filter((name) => runtime.assertions[name] !== true);
    assert(missing.length === 0, 'Missing G007 evidence assertions: ' + missing.join(', '));
    await writeReceipt('PASS', {
      issueNumber: 781,
      captureRole: runtime.g007Baseline ? 'before-layout-capture' : 'after-layout-verification',
      productAcceptance: 'OWNER_HUMAN_VISUAL_ACCEPTANCE_REQUIRED',
    });
    app.quit();
    return;
  }

  const bluehair = findBluehairCatalogEntry();
  assert(bluehair, 'The approved composed Bluehair candidate was absent from Main catalog.');
  await verifySelectionAndList(window);
  await focusCandidate(window, 'snapshot', bluehair.targetId, 0);
  await waitForCandidatePreview(window, bluehair.targetId);
  await verifyResponsiveAndTouch(window, bluehair.targetId);
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
    'bulkCancelNoMutation',
    'selectedViewKeepsGlobalChecksAndRestoresScroll',
    'selectedViewPreservesQueryAndExplainsPause',
    'shortCandidateFullNameAvailableOnTouch',
    'thumbnailFocusDoesNotSelect',
    'keyboardEnterTabSpaceWorks',
    'selectedViewIgnoresSearch',
    'syntheticBlankStateCaptured',
    'unsupportedStateCaptured',
    'failedPreviewUnavailable',
    'sequenceFocusDoesNotRender',
    'sequenceStartsAtOneAndCapsAt24',
    'sequenceOperationKeyboardAccessible',
    'sequenceControlsSeparatedFromCanvas',
    'sequenceDefaultRangeSummaryCorrect',
    'sequencePanelCompactAndAccessibleContrast',
    'sequenceGeneratedPreviewShowsFullFrameAtFit',
    'sequenceCancellationStopsRender',
    'sequenceNarrowTouchAccess',
    'sequenceRangeChangeInvalidatesCheck',
    'sequenceNearEndUsesShortRemainder',
    'sequenceAtoBtoARetainsCheck',
    'sequenceScenarioSelectionCleared',
    'touchTargetsAtLeast44CssPixels',
    'mouseFocusDoesNotShowRedundantOutline',
    'toolbarOneRowNormal',
    'toolbarReachableNarrow',
    'closeIconAccessibleAndReachable',
    'zoomControlsKeepDefaultReset',
    'importButtonHasVisibleCount',
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
    'receiptGuidanceInPlainLanguage',
    'receiptDiagnosticsCollapsed',
    'partialFailureReceiptTouchReachable',
    'partialFailureReceiptKeyboardReachable',
    'partialFailureReceiptReachableAtBothViewports',
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
