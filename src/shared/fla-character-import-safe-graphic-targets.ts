/**
 * Narrow, source-bound allowance for the two complete frame-zero poses proven
 * by Issue #961 R05. This does not make Graphic catalog entries generally
 * importable as Characters.
 */
const R05_SOURCE_SHA256 = '98fe84604b01edc3224b52cdcb07c11a3c2916f99ce1a99c224f026ecbc64606';

const R05_GRAPHIC_TARGETS = [
  {
    renderTargetId: 'fla-render-target-e5db7116dc714b4d5dd6d71a8a711899bfd1d9d28efb9a3974978657b2d885fe',
    sourceLibraryItemName: '修仙男-cilisucai.com1/修仙男-cilisucai.com2',
  },
  {
    renderTargetId: 'fla-render-target-43c0a17a5afe9d43579b7e14d0b40cc6b788defbb79afa6a2704c235c8c6324e',
    sourceLibraryItemName: '修仙男-cilisucai.com1/修仙男-cilisucai.com12',
  },
] as const;

export function isR05SafeGraphicCandidateId(renderTargetId: string): boolean {
  return R05_GRAPHIC_TARGETS.some((target) => target.renderTargetId === renderTargetId);
}

export function isR05SafeGraphicSource(
  rawSourceSha256: string,
  sourceLibraryItemName: string,
  selectedFrameIndex: number,
): boolean {
  if (rawSourceSha256.toLowerCase() !== R05_SOURCE_SHA256 || selectedFrameIndex !== 0) return false;
  return R05_GRAPHIC_TARGETS.some((target) => target.sourceLibraryItemName === sourceLibraryItemName);
}
