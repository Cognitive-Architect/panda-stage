/**
 * Bounded nested Graphic frame selection for static, authored XFL states.
 *
 * The base display-list resolver still consumes concrete frame contexts. This
 * selector prepares per-instance frame definitions first, preserving source
 * library identity while allowing two instances of one symbol to display
 * different authored frames. Unknown playback modes and tween interiors fail
 * closed.
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
  readonly firstFrame?: string;
  readonly lastFrame?: string;
  readonly sourceParentFrameIndex: number;
  readonly sourceParentFrameSpanStart: number;
  readonly childFrameCount: number;
  readonly selectedChildFrameIndex: number;
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
): { readonly ok: true; readonly frameIndex: number } | SelectorFailure {
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
  if (element.lastFrame !== undefined) {
    return failure(
      'UNSUPPORTED_TIMING',
      `Nested Graphic lastFrame is outside the proven static selection boundary: ${element.lastFrame}`,
      sourceAddress,
    );
  }

  const mode = element.playbackMode?.trim().toLocaleLowerCase('en-US');
  if (mode === 'single frame') {
    const selectedFrame = parseFrameIndex(element.firstFrame);
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
    return { ok: true, frameIndex: selectedFrame };
  }

  if (mode === 'loop' && element.firstFrame === undefined) {
    if (parentSpanStart !== 0) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Loop Graphic whose containing span starts at ${parentSpanStart} is outside the proven origin boundary`,
        sourceAddress,
      );
    }
    const elapsed = parentFrameIndex - parentSpanStart;
    if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
      return failure('UNSUPPORTED_TIMING', 'Loop Graphic has an invalid child timeline range', sourceAddress);
    }
    if (elapsed >= childFrameCount) {
      return failure(
        'UNSUPPORTED_TIMING',
        `Loop Graphic wrap is outside the proven boundary (elapsed=${elapsed}, childFrameCount=${childFrameCount})`,
        sourceAddress,
      );
    }
    return { ok: true, frameIndex: elapsed };
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
        sourceParentFrameIndex: parentFrameIndex,
        sourceParentFrameSpanStart: parentFrameSpanStart,
        childFrameCount: descriptor.frameCount,
        selectedChildFrameIndex: selected.frameIndex,
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
