/**
 * Pure 2D bounding-box alignment and distribution math.
 *
 * Adapted from Excalidraw's `packages/element/src/align.ts` and
 * `packages/element/src/distribute.ts` (MIT License).
 *
 * MIT License
 *
 * Copyright (c) 2020 Excalidraw
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { AffineMatrix2D } from '../../shared/affine-matrix';

export interface LayoutBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type LayoutAxis = 'x' | 'y';
export type LayoutAlignPosition = 'start' | 'center' | 'end';

export interface LayoutTranslation {
  readonly dx: number;
  readonly dy: number;
}

export type NegativeGapStrategy = 'center-distribute' | 'expand' | 'error';

export interface DistributeItemInput<TId extends string = string> {
  readonly id: TId;
  readonly bounds: LayoutBounds;
}

export interface DistributeOptions {
  /**
   * Behavior when items cannot fit with non-negative equal gaps inside their
   * combined span:
   * - `'center-distribute'`: distribute item centers evenly across the center span
   *   (Excalidraw's negative-gap fallback; items may overlap).
   * - `'expand'`: keep the starting edge anchored and place items sequentially with
   *   a fixed non-negative gap (`expandGapPx`, default 0), expanding past the
   *   original far edge.
   * - `'error'`: report insufficient space without moving items.
   */
  readonly negativeGapStrategy?: NegativeGapStrategy;
  /** Gap in pixels used when `negativeGapStrategy === 'expand'`. Defaults to 0. */
  readonly expandGapPx?: number;
}

export interface DistributeResult<TId extends string = string> {
  readonly ok: boolean;
  readonly translations: ReadonlyMap<TId, LayoutTranslation>;
  /** Raw equal-gap value before any negative-gap fallback (may be negative). */
  readonly rawGap: number;
  readonly negativeGapDetected: boolean;
  readonly usedStrategy: NegativeGapStrategy | null;
  /** True when a single item controls both outer edges of the selection span. */
  readonly degenerateSpan: boolean;
  readonly error?: string;
}

export function createLayoutBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): LayoutBounds {
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

export function boundsFromRect(rect: LayoutRect): LayoutBounds {
  const minX = Math.min(rect.x, rect.x + rect.width);
  const maxX = Math.max(rect.x, rect.x + rect.width);
  const minY = Math.min(rect.y, rect.y + rect.height);
  const maxY = Math.max(rect.y, rect.y + rect.height);
  return createLayoutBounds(minX, minY, maxX, maxY);
}

export function unionLayoutBounds(
  items: readonly LayoutBounds[],
): LayoutBounds | null {
  if (items.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of items) {
    if (item.minX < minX) minX = item.minX;
    if (item.minY < minY) minY = item.minY;
    if (item.maxX > maxX) maxX = item.maxX;
    if (item.maxY > maxY) maxY = item.maxY;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return createLayoutBounds(minX, minY, maxX, maxY);
}

export function translateLayoutBounds(
  bounds: LayoutBounds,
  dx: number,
  dy: number,
): LayoutBounds {
  return createLayoutBounds(
    bounds.minX + dx,
    bounds.minY + dy,
    bounds.maxX + dx,
    bounds.maxY + dy,
  );
}

/**
 * Transform all four corners of a local rectangle through an affine matrix and
 * return the resulting axis-aligned world bounding box.
 */
export function transformRectToWorldBounds(
  localRect: LayoutRect,
  worldMatrix: AffineMatrix2D,
): LayoutBounds | null {
  const x0 = localRect.x;
  const y0 = localRect.y;
  const x1 = localRect.x + localRect.width;
  const y1 = localRect.y + localRect.height;

  const corners: readonly [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [px, py] of corners) {
    const wx = worldMatrix.a * px + worldMatrix.c * py + worldMatrix.tx;
    const wy = worldMatrix.b * px + worldMatrix.d * py + worldMatrix.ty;
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) {
      return null;
    }
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }

  return createLayoutBounds(minX, minY, maxX, maxY);
}

/**
 * Compute the world-space translation required to align `itemBounds` to
 * `referenceBounds` along `axis` and `position`.
 */
export function computeAlignTranslation(
  itemBounds: LayoutBounds,
  referenceBounds: LayoutBounds,
  axis: LayoutAxis,
  position: LayoutAlignPosition,
): LayoutTranslation {
  if (axis === 'x') {
    const dx =
      position === 'start'
        ? referenceBounds.minX - itemBounds.minX
        : position === 'end'
          ? referenceBounds.maxX - itemBounds.maxX
          : referenceBounds.centerX - itemBounds.centerX;
    return { dx, dy: 0 };
  }
  const dy =
    position === 'start'
      ? referenceBounds.minY - itemBounds.minY
      : position === 'end'
        ? referenceBounds.maxY - itemBounds.maxY
        : referenceBounds.centerY - itemBounds.centerY;
  return { dx: 0, dy };
}

function axisMin(bounds: LayoutBounds, axis: LayoutAxis): number {
  return axis === 'x' ? bounds.minX : bounds.minY;
}

function axisMax(bounds: LayoutBounds, axis: LayoutAxis): number {
  return axis === 'x' ? bounds.maxX : bounds.maxY;
}

function axisSize(bounds: LayoutBounds, axis: LayoutAxis): number {
  return axis === 'x' ? bounds.width : bounds.height;
}

function axisCenter(bounds: LayoutBounds, axis: LayoutAxis): number {
  return axis === 'x' ? bounds.centerX : bounds.centerY;
}

function makeAxisTranslation(axis: LayoutAxis, delta: number): LayoutTranslation {
  return axis === 'x' ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
}

/**
 * Compute world-space translations to distribute `items` along `axis`.
 *
 * Follows Excalidraw's group-center ordering and equal-gap calculation:
 * - Normal case (`rawGap >= 0`, non-degenerate span): anchors the outer edges
 *   of the sorted sequence and places each item with equal spacing `rawGap`.
 * - Degenerate span (a single item simultaneously defines both outer min and
 *   max of the whole selection) or negative gap (`rawGap < 0`): handles
 *   explicitly via `options.negativeGapStrategy` instead of silently changing
 *   behavior.
 */
export function computeDistributeTranslations<TId extends string>(
  items: readonly DistributeItemInput<TId>[],
  axis: LayoutAxis,
  options: DistributeOptions = {},
): DistributeResult<TId> {
  const translations = new Map<TId, LayoutTranslation>();
  if (items.length < 3) {
    for (const item of items) {
      translations.set(item.id, { dx: 0, dy: 0 });
    }
    return {
      ok: true,
      translations,
      rawGap: 0,
      negativeGapDetected: false,
      usedStrategy: null,
      degenerateSpan: false,
    };
  }

  const combined = unionLayoutBounds(items.map((item) => item.bounds));
  if (!combined) {
    return {
      ok: false,
      translations,
      rawGap: 0,
      negativeGapDetected: false,
      usedStrategy: null,
      degenerateSpan: false,
      error: '无法计算选区整体边界。',
    };
  }

  // Sort by axis center (tie-break by axis start, then original order).
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const centerDiff =
        axisCenter(left.item.bounds, axis) - axisCenter(right.item.bounds, axis);
      if (Math.abs(centerDiff) > 1e-6) return centerDiff;
      const minDiff =
        axisMin(left.item.bounds, axis) - axisMin(right.item.bounds, axis);
      if (Math.abs(minDiff) > 1e-6) return minDiff;
      return left.index - right.index;
    })
    .map(({ item }) => item);

  const spanMin = axisMin(combined, axis);
  const spanMax = axisMax(combined, axis);
  const totalSpan = spanMax - spanMin;
  const totalSizes = sorted.reduce(
    (sum, item) => sum + axisSize(item.bounds, axis),
    0,
  );
  const rawGap = (totalSpan - totalSizes) / (sorted.length - 1);

  const degenerateSpan = sorted.some(
    (item) =>
      Math.abs(axisMin(item.bounds, axis) - spanMin) <= 1e-6 &&
      Math.abs(axisMax(item.bounds, axis) - spanMax) <= 1e-6,
  );
  const negativeGapDetected = rawGap < -1e-6 || degenerateSpan;

  if (!negativeGapDetected) {
    let cursor = spanMin;
    for (const item of sorted) {
      const delta = cursor - axisMin(item.bounds, axis);
      translations.set(item.id, makeAxisTranslation(axis, delta));
      cursor += axisSize(item.bounds, axis) + rawGap;
    }
    return {
      ok: true,
      translations,
      rawGap,
      negativeGapDetected: false,
      usedStrategy: null,
      degenerateSpan: false,
    };
  }

  const strategy: NegativeGapStrategy =
    options.negativeGapStrategy ?? 'center-distribute';

  if (strategy === 'error') {
    return {
      ok: false,
      translations,
      rawGap,
      negativeGapDetected: true,
      usedStrategy: 'error',
      degenerateSpan,
      error: degenerateSpan
        ? '存在单个对象同时跨越选区两端，无法按等间距排列，请选择「中心等分」或「向外扩展」。'
        : '选区空间不足以放下无重叠间距，请选择「中心等分」或「向外扩展」。',
    };
  }

  if (strategy === 'expand') {
    const gap = Math.max(0, Number.isFinite(options.expandGapPx) ? (options.expandGapPx ?? 0) : 0);
    let cursor = spanMin;
    for (const item of sorted) {
      const delta = cursor - axisMin(item.bounds, axis);
      translations.set(item.id, makeAxisTranslation(axis, delta));
      cursor += axisSize(item.bounds, axis) + gap;
    }
    return {
      ok: true,
      translations,
      rawGap,
      negativeGapDetected: true,
      usedStrategy: 'expand',
      degenerateSpan,
    };
  }

  // 'center-distribute': Excalidraw-style equal distribution of item centers.
  const firstCenter = axisCenter(sorted[0]!.bounds, axis);
  const lastCenter = axisCenter(sorted[sorted.length - 1]!.bounds, axis);
  const centerSpan = lastCenter - firstCenter;
  const centerStep = centerSpan / (sorted.length - 1);

  for (let i = 0; i < sorted.length; i += 1) {
    const item = sorted[i]!;
    const targetCenter = firstCenter + centerStep * i;
    const delta = targetCenter - axisCenter(item.bounds, axis);
    translations.set(item.id, makeAxisTranslation(axis, delta));
  }

  return {
    ok: true,
    translations,
    rawGap,
    negativeGapDetected: true,
    usedStrategy: 'center-distribute',
    degenerateSpan,
  };
}
