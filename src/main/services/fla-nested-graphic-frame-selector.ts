/**
 * Selects nested Graphic frames from concrete Panda display-list contexts. The
 * pinned fla-viewer frame evaluator owns loop, play-once, single-frame, reverse,
 * and first/last-frame range behavior; Panda validates source bounds and keeps
 * source-authored values and per-instance provenance intact.
 */

import crypto from 'node:crypto';
import {
  FLA_DISPLAY_LIST_IDENTITY_MATRIX,
  type FlaDisplayListElement,
  type FlaDisplayListFrameContext,
  type FlaDisplayListMatrix,
  type FlaDisplayListResolverInput,
  type FlaDisplayListRoot,
  type FlaGraphicSymbolDefinition,
} from './fla-display-list-resolver';
import type { FlaStaticSnapshotDisplaySource } from './fla-static-snapshot-display-list-adapter';
import { evaluateFlaViewerGraphicFrame } from './fla-viewer-tween-evaluator';

export const FLA_NESTED_GRAPHIC_FRAME_SELECTOR_LIMITS = Object.freeze({
  maxDepth: 64,
  maxSelections: 10_000,
});

export interface FlaNestedGraphicFrameSelection {
  readonly sourceAddress: string;
  readonly libraryItemName: string;
  /** Absent when the source omitted the playback-mode attribute. */
  readonly playbackMode?: string;
  /**
   * Source-authored firstFrame attribute, preserved verbatim. Absent when the
   * source omitted the attribute (raw provenance: missing is never rewritten to
   * an authored '0').
   */
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  /**
   * Whether the selected first frame came from an authored attribute.
   * Missing `firstFrame` stays distinguishable from an authored
   * `firstFrame="0"` even though both pass an origin of zero to the evaluator.
   */
  readonly firstFrameWasExplicit: boolean;
  /**
   * The authored first-frame value or the default origin of zero, before the
   * evaluator normalizes it against the child timeline length.
   */
  readonly effectiveFirstFrame: number;
  readonly sourceParentFrameIndex: number;
  readonly sourceParentFrameSpanStart: number;
  readonly childFrameCount: number;
  readonly selectedChildFrameIndex: number;
  readonly selectionRule:
    | 'mode-invariant-single-frame'
    | 'loop-parent-timeline'
    | 'loop-reverse-parent-timeline'
    | 'play-once-parent-timeline'
    | 'play-once-reverse-parent-timeline'
    | 'play-once-hold-terminal'
    | 'single-frame-parent-keyframe';
  readonly selectionBasis?: 'mode-invariant-single-frame';
  readonly sourceTransform: FlaDisplayListMatrix;
}

export type FlaNestedGraphicFrameSelectorFailureCode =
  | 'UNKNOWN_PLAYBACK_DEFAULT'
  | 'UNSUPPORTED_TIMING'
  | 'UNSUPPORTED_SYMBOL_TYPE'
  | 'MISSING_SYMBOL'
  | 'SYMBOL_CYCLE'
  | 'UNSUPPORTED_TWEEN'
  | 'FRAME_CONTEXT_FAILED'
  | 'BUDGET_EXCEEDED';

export type FlaNestedGraphicFrameSelectorResult =
  | {
      readonly ok: true;
      readonly resolverInput: FlaDisplayListResolverInput;
      readonly selections: readonly FlaNestedGraphicFrameSelection[];
    }
  | {
      readonly ok: false;
      readonly code: FlaNestedGraphicFrameSelectorFailureCode;
      readonly message: string;
      readonly sourceAddress?: string;
    };

type SelectorFailure = Extract<FlaNestedGraphicFrameSelectorResult, { readonly ok: false }>;
type ElementsResult =
  | { readonly ok: true; readonly elements: readonly FlaDisplayListElement[] }
  | SelectorFailure;
type ContextResult =
  | { readonly ok: true; readonly frameContext: FlaDisplayListFrameContext }
  | SelectorFailure;

function failure(
  code: FlaNestedGraphicFrameSelectorFailureCode,
  message: string,
  sourceAddress?: string,
): SelectorFailure {
  return { ok: false, code, message, ...(sourceAddress ? { sourceAddress } : {}) };
}

function parseFrameIndex(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function frameSelectionKey(libraryItemName: string, frameIndex: number, sourceAddress: string): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([libraryItemName, frameIndex, sourceAddress]), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `fla-graphic-frame-${digest}`;
}

function selectAuthoredChildFrame(
  element: Extract<FlaDisplayListElement, { readonly kind: 'symbol' }>,
  childFrameCount: number,
): {
  readonly ok: true;
  readonly frameIndex: number;
  readonly selectionRule: FlaNestedGraphicFrameSelection['selectionRule'];
  readonly selectionBasis?: FlaNestedGraphicFrameSelection['selectionBasis'];
  readonly effectiveFirstFrame: number;
} | SelectorFailure {
  const sourceAddress = element.sourceAddress;
  const parentFrameIndex = element.sourceParentFrameIndex;
  const parentSpanStart = element.sourceParentFrameSpanStart;
  if (!Number.isSafeInteger(childFrameCount) || childFrameCount <= 0) {
    return failure('UNSUPPORTED_TIMING', 'Nested Graphic child timeline has no valid frame range', sourceAddress);
  }
  const mode = element.playbackMode?.trim().toLocaleLowerCase('en-US');
  // #726: the one-frame case is invariant across playback modes. Keep the source
  // mode absent; a multiframe child still needs an explicit playback contract.
  if (mode === undefined) {
    if (childFrameCount === 1) {
      return {
        ok: true,
        frameIndex: 0,
        selectionRule: 'mode-invariant-single-frame',
        selectionBasis: 'mode-invariant-single-frame',
        effectiveFirstFrame: 0,
      };
    }
    return failure(
      'UNKNOWN_PLAYBACK_DEFAULT',
      `UNKNOWN_PLAYBACK_DEFAULT: missing Graphic playback mode with childFrameCount=${childFrameCount}`,
      sourceAddress,
    );
  }
  if (!Number.isSafeInteger(parentFrameIndex) || !Number.isSafeInteger(parentSpanStart) ||
      parentFrameIndex === undefined || parentSpanStart === undefined || parentFrameIndex < parentSpanStart) {
    return failure(
      'UNSUPPORTED_TIMING',
      'Nested Graphic instance has no valid selected parent frame and containing DOMFrame span address',
      sourceAddress,
    );
  }

  const supportedModes = new Set([
    'loop', 'play once', 'single frame', 'loop reverse', 'play once reverse',
  ]);
  if (!supportedModes.has(mode)) {
    return failure(
      'UNSUPPORTED_TIMING',
      `Nested Graphic playback mode is unsupported: ${element.playbackMode ?? '(missing)'}`,
      sourceAddress,
    );
  }
  const firstFrame = element.firstFrame === undefined ? 0 : parseFrameIndex(element.firstFrame);
  if (firstFrame === null) {
    return failure('UNSUPPORTED_TIMING', `Graphic firstFrame is invalid: ${element.firstFrame}`, sourceAddress);
  }
  const syncedSingletonLoopOrigin = mode === 'loop' && element.sourceParentSpanTweenType === 'motion' &&
    element.sourceParentMotionTweenSync === true && childFrameCount === 1 &&
    element.firstFrame !== undefined && element.lastFrame === undefined;
  if (firstFrame >= childFrameCount && !syncedSingletonLoopOrigin) {
    return failure(
      'UNSUPPORTED_TIMING',
      `Graphic firstFrame=${firstFrame} is outside child frameCount ${childFrameCount}`,
      sourceAddress,
    );
  }
  let lastFrame: number | undefined;
  if (element.lastFrame !== undefined) {
    const rawLastFrame = element.lastFrame.trim();
    if (!/^-?\d+$/u.test(rawLastFrame)) {
      return failure('UNSUPPORTED_TIMING', `Graphic lastFrame is invalid: ${element.lastFrame}`, sourceAddress);
    }
    const parsedLastFrame = Number(rawLastFrame);
    if (!Number.isSafeInteger(parsedLastFrame)) {
      return failure('UNSUPPORTED_TIMING', `Graphic lastFrame is invalid: ${element.lastFrame}`, sourceAddress);
    }
    // The pinned viewer treats a negative lastFrame as an unbounded range.
    if (parsedLastFrame >= 0) lastFrame = parsedLastFrame;
  }
  const elapsed = parentFrameIndex - parentSpanStart;
  const selected = evaluateFlaViewerGraphicFrame(mode, firstFrame, lastFrame, childFrameCount, elapsed);
  if (!selected.ok) return failure('UNSUPPORTED_TIMING', selected.message, sourceAddress);

  let selectionRule: FlaNestedGraphicFrameSelection['selectionRule'];
  if (mode === 'single frame') {
    selectionRule = 'single-frame-parent-keyframe';
  } else if (mode === 'loop reverse') {
    selectionRule = 'loop-reverse-parent-timeline';
  } else if (mode === 'loop') {
    selectionRule = 'loop-parent-timeline';
  } else {
    const reverse = mode === 'play once reverse';
    const distanceToTerminal = lastFrame === undefined
      ? (reverse ? firstFrame : childFrameCount - 1 - firstFrame)
      : reverse
        ? ((firstFrame - lastFrame + childFrameCount) % childFrameCount)
        : ((lastFrame - firstFrame + childFrameCount) % childFrameCount);
    const held = elapsed > distanceToTerminal;
    selectionRule = held
      ? 'play-once-hold-terminal'
      : reverse ? 'play-once-reverse-parent-timeline' : 'play-once-parent-timeline';
  }
  return {
    ok: true,
    frameIndex: selected.frameIndex,
    selectionRule,
    effectiveFirstFrame: firstFrame,
  };
}

/**
 * Select one authored state for each active nested Graphic instance. The
 * returned resolver map uses per-frame lookup keys; display-list nodes retain
 * their original library item names and source transforms.
 */
export function prepareFlaNestedGraphicFrameSelections(
  source: FlaStaticSnapshotDisplaySource,
  root: FlaDisplayListRoot,
  options: { readonly maxDepth?: number; readonly maxSelections?: number } = {},
): FlaNestedGraphicFrameSelectorResult {
  const maxDepth = options.maxDepth ?? FLA_NESTED_GRAPHIC_FRAME_SELECTOR_LIMITS.maxDepth;
  const maxSelections = options.maxSelections ?? FLA_NESTED_GRAPHIC_FRAME_SELECTOR_LIMITS.maxSelections;
  if (!Number.isSafeInteger(maxDepth) || maxDepth <= 0 ||
      !Number.isSafeInteger(maxSelections) || maxSelections <= 0) {
    return failure('BUDGET_EXCEEDED', 'Nested Graphic selector limits must be positive safe integers');
  }

  const descriptors = new Map(source.graphicSymbols.map((symbol) => [symbol.sourceLibraryItemName, symbol]));
  const definitions = new Map<string, FlaGraphicSymbolDefinition>();
  const selections: FlaNestedGraphicFrameSelection[] = [];
  const building = new Set<string>();

  const prepareSymbol = (
    libraryItemName: string,
    frameIndex: number,
    sourceStack: readonly string[],
    depth: number,
    sourceAddress: string,
  ): { readonly ok: true; readonly key: string } | SelectorFailure => {
    if (sourceStack.includes(libraryItemName)) {
      return failure(
        'SYMBOL_CYCLE',
        `Nested Graphic cycle: ${[...sourceStack, libraryItemName].join(' -> ')}`,
        sourceAddress,
      );
    }
    if (depth > maxDepth) {
      return failure('BUDGET_EXCEEDED', `Nested Graphic depth exceeded ${maxDepth}`, sourceAddress);
    }

    const key = frameSelectionKey(libraryItemName, frameIndex, sourceAddress);
    if (building.has(key)) {
      return failure('SYMBOL_CYCLE', `Nested Graphic frame cycle at ${libraryItemName}@${frameIndex}`, sourceAddress);
    }
    const descriptor = descriptors.get(libraryItemName);
    if (!descriptor) {
      return failure('MISSING_SYMBOL', `Nested Graphic definition not found: ${libraryItemName}`, sourceAddress);
    }
    if (frameIndex < 0 || frameIndex >= descriptor.frameCount) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Selected child frame ${frameIndex} is outside ${libraryItemName} frameCount ${descriptor.frameCount}`,
        sourceAddress,
      );
    }

    building.add(key);
    const contextResult = source.buildGraphicFrameContext(
      descriptor.timelineXml,
      descriptor.frameSpanIndex,
      frameIndex,
      `nested:${sourceAddress}->${libraryItemName}@${frameIndex}`,
    );
    if (!contextResult.ok) {
      building.delete(key);
      const tweenInterior = /unsupported\s+(?:motion|shape)\s+tween\s+interpolation/iu.test(contextResult.message);
      return failure(
        tweenInterior ? 'UNSUPPORTED_TWEEN' :
          contextResult.code === 'BUDGET_EXCEEDED' ? 'BUDGET_EXCEEDED' : 'FRAME_CONTEXT_FAILED',
        contextResult.message,
        sourceAddress,
      );
    }

    const prepared = prepareContext(
      contextResult.value,
      [...sourceStack, libraryItemName],
      depth + 1,
    );
    building.delete(key);
    if (!prepared.ok) return prepared;
    definitions.set(key, { kind: 'graphic', libraryItemName, frameContext: prepared.frameContext });
    return { ok: true, key };
  };

  const prepareElements = (
    elements: readonly FlaDisplayListElement[],
    sourceStack: readonly string[],
    depth: number,
  ): ElementsResult => {
    const prepared: FlaDisplayListElement[] = [];
    for (const element of elements) {
      if (element.visible === false) {
        prepared.push(element);
        continue;
      }
      if (element.kind === 'group') {
        const nested = prepareElements(element.elements, sourceStack, depth);
        if (!nested.ok) return nested;
        prepared.push({ ...element, elements: nested.elements });
        continue;
      }
      if (element.kind !== 'symbol') {
        prepared.push(element);
        continue;
      }
      if (element.symbolType !== 'graphic') {
        return failure(
          'UNSUPPORTED_SYMBOL_TYPE',
          `Nested static reconstruction does not execute ${element.symbolType} symbols: ${element.libraryItemName}`,
          element.sourceAddress,
        );
      }
      if (selections.length >= maxSelections) {
        return failure('BUDGET_EXCEEDED', `Nested Graphic selection count exceeded ${maxSelections}`, element.sourceAddress);
      }
      const descriptor = descriptors.get(element.libraryItemName);
      if (!descriptor) {
        return failure('MISSING_SYMBOL', `Nested Graphic definition not found: ${element.libraryItemName}`, element.sourceAddress);
      }
      const selected = selectAuthoredChildFrame(element, descriptor.frameCount);
      if (!selected.ok) return selected;
      const sourceAddress = element.sourceAddress?.trim();
      const parentFrameIndex = element.sourceParentFrameIndex;
      const parentFrameSpanStart = element.sourceParentFrameSpanStart;
      if (!sourceAddress || parentFrameIndex === undefined || parentFrameSpanStart === undefined) {
        return failure(
          'UNSUPPORTED_TIMING',
          'Nested Graphic instance is missing its source address or parent frame coordinates',
          element.sourceAddress,
        );
      }
      selections.push({
        sourceAddress,
        libraryItemName: element.libraryItemName,
        ...(element.playbackMode !== undefined
          ? { playbackMode: element.playbackMode.trim().toLocaleLowerCase('en-US') }
          : {}),
        ...(element.firstFrame !== undefined ? { firstFrame: element.firstFrame } : {}),
        ...(element.lastFrame !== undefined ? { lastFrame: element.lastFrame } : {}),
        firstFrameWasExplicit: element.firstFrame !== undefined,
        effectiveFirstFrame: selected.effectiveFirstFrame,
        sourceParentFrameIndex: parentFrameIndex,
        sourceParentFrameSpanStart: parentFrameSpanStart,
        childFrameCount: descriptor.frameCount,
        selectedChildFrameIndex: selected.frameIndex,
        selectionRule: selected.selectionRule,
        ...(selected.selectionBasis ? { selectionBasis: selected.selectionBasis } : {}),
        sourceTransform: element.localTransform ?? FLA_DISPLAY_LIST_IDENTITY_MATRIX,
      });
      const variant = prepareSymbol(
        element.libraryItemName,
        selected.frameIndex,
        sourceStack,
        depth + 1,
        sourceAddress,
      );
      if (!variant.ok) return variant;
      prepared.push({ ...element, frameSelectionKey: variant.key });
    }
    return { ok: true, elements: prepared };
  };

  function prepareContext(
    context: FlaDisplayListFrameContext,
    sourceStack: readonly string[],
    depth: number,
  ): ContextResult {
    if (depth > maxDepth) return failure('BUDGET_EXCEEDED', `Nested Graphic depth exceeded ${maxDepth}`);
    const layers = [];
    for (const layer of context.layers) {
      if (!layer.visible) {
        layers.push(layer);
        continue;
      }
      const elements = prepareElements(layer.elements, sourceStack, depth);
      if (!elements.ok) return elements;
      layers.push({ ...layer, elements: elements.elements });
    }
    return { ok: true, frameContext: { ...context, layers } };
  }

  const rootResult = prepareContext(root.frameContext, root.kind === 'graphic' ? [root.name] : [], 0);
  if (!rootResult.ok) return rootResult;
  return {
    ok: true,
    resolverInput: {
      root: { ...root, frameContext: rootResult.frameContext },
      symbols: definitions,
    },
    selections,
  };
}
