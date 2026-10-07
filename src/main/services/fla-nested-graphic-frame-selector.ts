/**
 * Bounded nested Graphic frame selection for static, authored XFL states.
 *
 * The base display-list resolver still consumes concrete frame contexts. This
 * selector prepares per-instance frame definitions first, preserving source
 * library identity while allowing two instances of one symbol to display
 * different authored frames. Unknown playback modes and tween interiors fail
 * closed.
 *
 * Issue #721 adds one bounded subset (#720 A1, SOURCE/EXTERNAL-PROVEN): an
 * explicit Loop with an explicit static/span-local firstFrame over a known child
 * range selects `firstFrame + (elapsed % N)`; the wrap target is firstFrame, not
 * child frame 0.
 *
 * Issue #723 extends the same bounded family (#720 A4, SOURCE/EXTERNAL-PROVEN):
 * when a forward Loop omits the firstFrame attribute, its effective first frame
 * is the proven default 0 (`effectiveFirstFrame = authoredFirstFrame ?? 0`) and
 * the identical modulo selector applies over `N = childFrameCount`. The raw
 * authored absence is preserved — `firstFrame` stays undefined and
 * `firstFrameWasExplicit` records the distinction — so a missing attribute is
 * never rewritten into an authored `firstFrame="0"`. The owning span origin
 * participates only in the `elapsed` calculation, never as an implicit first
 * frame; the #721 static-span gate keeps guarding an AUTHORED firstFrame (which a
 * tween could animate) but does not apply to an absent attribute.
 *
 * Everything else (animated/tweened firstFrame, missing-loop multi-frame default,
 * reverse loop, generic lastFrame animation) remains fail-closed.
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

export const FLA_NESTED_GRAPHIC_FRAME_SELECTOR_LIMITS = Object.freeze({
  maxDepth: 64,
  maxSelections: 10_000,
});

export interface FlaNestedGraphicFrameSelection {
  readonly sourceAddress: string;
  readonly libraryItemName: string;
  readonly playbackMode: string;
  /**
   * Source-authored firstFrame attribute, preserved verbatim. Absent when the
   * source omitted the attribute (raw provenance: missing is never rewritten to
   * an authored '0').
   */
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  /**
   * Whether the selected first frame came from an authored attribute.
   * `missing firstFrame` (false) is kept distinguishable from an authored
   * `firstFrame="0"` (true) even though both are bounded-equivalent (#723 M1-A).
   */
  readonly firstFrameWasExplicit: boolean;
  /**
   * The first frame actually used by the selection rule
   * (`authoredFirstFrame ?? 0`). Recorded so the bounded fallback is observable
   * without re-deriving it from the source attributes (#723).
   */
  readonly effectiveFirstFrame: number;
  readonly sourceParentFrameIndex: number;
  readonly sourceParentFrameSpanStart: number;
  readonly childFrameCount: number;
  readonly selectedChildFrameIndex: number;
  readonly selectionRule:
    | 'single-frame-explicit-first-frame'
    | 'single-frame-default-first-frame-zero'
    | 'loop-single-frame-constant'
    | 'loop-static-first-frame-modulo'
    | 'loop-missing-first-frame-modulo'
    | 'play-once-relative-containing-span'
    | 'play-once-hold-last-frame';
  readonly sourceTransform: FlaDisplayListMatrix;
}

export type FlaNestedGraphicFrameSelectorFailureCode =
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
  readonly effectiveFirstFrame: number;
} | SelectorFailure {
  const sourceAddress = element.sourceAddress;
  const parentFrameIndex = element.sourceParentFrameIndex;
  const parentSpanStart = element.sourceParentFrameSpanStart;
  if (!Number.isSafeInteger(childFrameCount) || childFrameCount <= 0) {
    return failure('UNSUPPORTED_TIMING', 'Nested Graphic child timeline has no valid frame range', sourceAddress);
  }
  if (!Number.isSafeInteger(parentFrameIndex) || !Number.isSafeInteger(parentSpanStart) ||
      parentFrameIndex === undefined || parentSpanStart === undefined || parentFrameIndex < parentSpanStart) {
    return failure(
      'UNSUPPORTED_TIMING',
      'Nested Graphic instance has no valid selected parent frame and containing DOMFrame span address',
      sourceAddress,
    );
  }
  const mode = element.playbackMode?.trim().toLocaleLowerCase('en-US');

  // #721/#723 — bounded forward Loop (#720 A1/A4). The child range is closed by
  // an authored or defaulted first frame:
  //   authoredFirstFrame  = element.firstFrame (undefined when the attribute is absent)
  //   effectiveFirstFrame = authoredFirstFrame ?? 0
  //   L = lastFrame ?? childFrameCount - 1,  N = L - F + 1
  //   childFrame = F + (elapsed % N)   (wrap target is F, never child frame 0)
  // The static/span-local owning-span gate (#721 / #720 A3) guards an AUTHORED
  // firstFrame, because a tween can animate that attribute across the span
  // (UNPROVEN_ANIMATED_FIRST_FRAME_SEMANTIC). An absent firstFrame carries no
  // value a tween could override (#720 A4), so the defaulted path only consumes
  // the owning span origin as `elapsed`. Raw authored absence is preserved:
  // `firstFrame` stays undefined and `firstFrameWasExplicit` records the
  // missing-vs-authored-'0' distinction. This is the ONLY branch authorized to
  // consume an authored lastFrame.
  if (mode === 'loop') {
    const firstFrameWasExplicit = element.firstFrame !== undefined;
    const firstFrame = firstFrameWasExplicit ? parseFrameIndex(element.firstFrame) : 0;
    if (firstFrame === null) {
      return failure(
        'UNSUPPORTED_TIMING',
        'Loop Graphic requires a valid source-authored firstFrame',
        sourceAddress,
      );
    }
    if (firstFrameWasExplicit && element.sourceParentSpanTweenType !== 'none') {
      return failure(
        'UNSUPPORTED_TIMING',
        'Loop Graphic with an explicit firstFrame is only proven inside a static authored span; a tweened owning span (animated firstFrame) stays fail-closed',
        sourceAddress,
      );
    }
    // A constant one-frame Loop has no range to advance; keep its dedicated rule.
    if (!firstFrameWasExplicit && element.lastFrame === undefined && childFrameCount === 1) {
      return { ok: true, frameIndex: 0, selectionRule: 'loop-single-frame-constant', effectiveFirstFrame: 0 };
    }
    const lastFrame = element.lastFrame === undefined
      ? childFrameCount - 1
      : parseFrameIndex(element.lastFrame);
    if (lastFrame === null) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Loop Graphic lastFrame is not a valid non-negative index: ${element.lastFrame}`,
        sourceAddress,
      );
    }
    if (firstFrame > lastFrame || lastFrame >= childFrameCount) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Loop Graphic bounds fall outside child frameCount ${childFrameCount} (firstFrame=${firstFrame}, lastFrame=${lastFrame})`,
        sourceAddress,
      );
    }
    const rangeLength = lastFrame - firstFrame + 1;
    const elapsed = parentFrameIndex - parentSpanStart;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
      return failure('UNSUPPORTED_TIMING', 'Loop Graphic has an invalid child timeline range', sourceAddress);
    }
    return {
      ok: true,
      frameIndex: firstFrame + (elapsed % rangeLength),
      selectionRule: firstFrameWasExplicit
        ? 'loop-static-first-frame-modulo'
        : 'loop-missing-first-frame-modulo',
      effectiveFirstFrame: firstFrame,
    };
  }

  if (element.lastFrame !== undefined) {
    return failure(
      'UNSUPPORTED_TIMING',
      `Nested Graphic lastFrame is outside the proven static selection boundary: ${element.lastFrame}`,
      sourceAddress,
    );
  }

  if (mode === 'single frame') {
    const selectedFrame = element.firstFrame === undefined ? 0 : parseFrameIndex(element.firstFrame);
    if (selectedFrame === null) {
      return failure(
        'UNSUPPORTED_TIMING',
        'Single Frame Graphic requires a valid source-authored firstFrame',
        sourceAddress,
      );
    }
    if (selectedFrame >= childFrameCount) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Single Frame firstFrame ${selectedFrame} is outside child frameCount ${childFrameCount}`,
        sourceAddress,
      );
    }
    return {
      ok: true,
      frameIndex: selectedFrame,
      selectionRule: element.firstFrame === undefined
        ? 'single-frame-default-first-frame-zero'
        : 'single-frame-explicit-first-frame',
      effectiveFirstFrame: selectedFrame,
    };
  }

  if (mode === 'play once') {
    const firstFrame = element.firstFrame === undefined ? 0 : parseFrameIndex(element.firstFrame);
    if (firstFrame === null) {
      return failure('UNSUPPORTED_TIMING', 'Play Once Graphic has an invalid firstFrame', sourceAddress);
    }
    if (firstFrame >= childFrameCount) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Play Once firstFrame ${firstFrame} is outside child frameCount ${childFrameCount}`,
        sourceAddress,
      );
    }
    const elapsed = parentFrameIndex - parentSpanStart;
    const requestedFrame = firstFrame + elapsed;
    if (!Number.isSafeInteger(requestedFrame) || requestedFrame < firstFrame) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Play Once selection is invalid (firstFrame=${firstFrame}, elapsed=${elapsed})`,
        sourceAddress,
      );
    }
    const lastFrame = childFrameCount - 1;
    const selectedFrame = Math.min(requestedFrame, lastFrame);
    return {
      ok: true,
      frameIndex: selectedFrame,
      selectionRule: requestedFrame > lastFrame
        ? 'play-once-hold-last-frame'
        : 'play-once-relative-containing-span',
      effectiveFirstFrame: firstFrame,
    };
  }

  return failure(
    'UNSUPPORTED_TIMING',
    `Nested Graphic playback mode or bounds are outside the proven boundary (loop=${element.playbackMode ?? '(missing)'}, firstFrame=${element.firstFrame ?? '(missing)'})`,
    sourceAddress,
  );
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
        playbackMode: element.playbackMode?.trim().toLocaleLowerCase('en-US') ?? '',
        ...(element.firstFrame !== undefined ? { firstFrame: element.firstFrame } : {}),
        ...(element.lastFrame !== undefined ? { lastFrame: element.lastFrame } : {}),
        firstFrameWasExplicit: element.firstFrame !== undefined,
        effectiveFirstFrame: selected.effectiveFirstFrame,
        sourceParentFrameIndex: parentFrameIndex,
        sourceParentFrameSpanStart: parentFrameSpanStart,
        childFrameCount: descriptor.frameCount,
        selectedChildFrameIndex: selected.frameIndex,
        selectionRule: selected.selectionRule,
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
