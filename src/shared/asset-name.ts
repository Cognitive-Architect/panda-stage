/**
 * Shared filename normalization used by the existing Asset import path and
 * the read-only FLA naming preview.  This module deliberately has no Node or
 * Electron dependency so the preview cannot acquire filesystem authority.
 */

export type AssetFileExtension =
  | '.png'
  | '.jpg'
  | '.jpeg'
  | '.mp3'
  | '.wav';

export interface AssetNameAnalysis {
  sourceName: string;
  targetFileName: string;
  displayName: string;
  hadInvalidWindowsCharacters: boolean;
  hadTrailingDotOrSpace: boolean;
  wasReservedWindowsName: boolean;
  wasNormalized: boolean;
}

function basename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function extension(value: string): string {
  const name = basename(value);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

export function safeUtf16Slice(value: string, maximumLength: number): string {
  let result = value.slice(0, maximumLength);
  const lastCodeUnit = result.charCodeAt(result.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    result = result.slice(0, -1);
  }
  return result;
}

export function assetDisplayName(sourceName: string): string {
  const name = basename(sourceName);
  const sourceExtension = extension(name);
  const stem = sourceExtension
    ? name.slice(0, -sourceExtension.length)
    : name;
  const normalized = stem
    .normalize('NFC')
    .replace(/\p{Cc}/gu, '_')
    .trim();
  return safeUtf16Slice(normalized || 'Imported asset', 200);
}

export function analyzeAssetFileName(
  sourceName: string,
  targetExtension: AssetFileExtension,
): AssetNameAnalysis {
  const name = basename(sourceName).trim() || 'unnamed asset';
  const sourceExtension = extension(name);
  const rawStem = sourceExtension
    ? name.slice(0, -sourceExtension.length)
    : name;
  const hadInvalidWindowsCharacters = /[\p{Cc}<>:"/\\|?*]/u.test(rawStem);
  const hadTrailingDotOrSpace = /[. ]+$/u.test(rawStem);
  const normalizedStem = rawStem
    .normalize('NFC')
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/[. ]+$/gu, '')
    .trim() || 'asset';
  const safeStem = safeUtf16Slice(normalizedStem, 120);
  const wasReservedWindowsName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(
    safeStem,
  );
  const normalizedStemWithReservedHandling = wasReservedWindowsName
    ? `_${safeStem}`
    : safeStem;
  const targetFileName = `${normalizedStemWithReservedHandling}${targetExtension}`;

  return {
    sourceName: name,
    targetFileName,
    displayName: assetDisplayName(name),
    hadInvalidWindowsCharacters,
    hadTrailingDotOrSpace,
    wasReservedWindowsName,
    wasNormalized:
      normalizedStemWithReservedHandling !== rawStem ||
      sourceExtension.toLowerCase() !== targetExtension,
  };
}

export function sanitizeAssetFileName(
  sourceName: string,
  targetExtension: AssetFileExtension,
): string {
  return analyzeAssetFileName(sourceName, targetExtension).targetFileName;
}
