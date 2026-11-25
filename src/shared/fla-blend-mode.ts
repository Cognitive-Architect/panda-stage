/**
 * Supported FLA symbol blend modes and formal compositing mappings (S01-C / #1296).
 *
 * Blend-mode normalization and Canvas 2D composite mapping (`multiply`, `screen`,
 * `add` -> `lighter`) are adapted from lifeart/fla-viewer@b14fa1d
 * (https://github.com/lifeart/fla-viewer/blob/b14fa1d1e3e2d2b035e174bde472a7941d385b17/src/renderer.ts#L4435-L4455;
 * declared ISC in README.md L161-163 and package.json L21; no standalone LICENSE
 * file exists at that pinned commit). Unsupported/approximated advanced modes
 * (layer, darken, lighten, difference, invert, alpha, erase, overlay, hardlight,
 * subtract, etc.) are intentionally rejected so callers degrade locally with
 * diagnostics rather than silently mis-compositing.
 */

import { z } from 'zod';

export const SUPPORTED_FLA_BLEND_MODES = ['multiply', 'screen', 'add'] as const;

export type FlaSupportedBlendMode = (typeof SUPPORTED_FLA_BLEND_MODES)[number];
export type FlaBlendMode = 'normal' | FlaSupportedBlendMode;
export type FlaCanvasCompositeOperation = 'source-over' | 'multiply' | 'screen' | 'lighter';
export type FlaSvgMixBlendMode = 'multiply' | 'screen' | 'plus-lighter';

export const FlaSupportedBlendModeSchema = z.enum(SUPPORTED_FLA_BLEND_MODES);

export type ParseXflBlendModeResult =
  | { readonly ok: true; readonly blendMode: FlaSupportedBlendMode | undefined }
  | { readonly ok: false; readonly raw: string; readonly reason: string };

export function parseXflBlendMode(raw: string | undefined): ParseXflBlendModeResult {
  if (raw === undefined) return { ok: true, blendMode: undefined };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, blendMode: undefined };
  const normalized = trimmed.toLowerCase();
  if (normalized === 'normal') return { ok: true, blendMode: undefined };
  if (normalized === 'multiply' || normalized === 'screen' || normalized === 'add') {
    return { ok: true, blendMode: normalized };
  }
  return {
    ok: false,
    raw: trimmed,
    reason: `Unsupported XFL blendMode "${trimmed}"`,
  };
}

export function flaBlendModeToCanvasCompositeOperation(
  blendMode: FlaBlendMode | undefined,
): FlaCanvasCompositeOperation {
  switch (blendMode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'add':
      return 'lighter';
    default:
      return 'source-over';
  }
}

export function flaBlendModeToSvgMixBlendMode(
  blendMode: FlaBlendMode | undefined,
): FlaSvgMixBlendMode | null {
  switch (blendMode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'add':
      return 'plus-lighter';
    default:
      return null;
  }
}
