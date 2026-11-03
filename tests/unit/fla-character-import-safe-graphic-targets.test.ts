import { describe, expect, it } from 'vitest';
import {
  isR05SafeGraphicCandidateId,
  isR05SafeGraphicSource,
} from '../../src/shared/fla-character-import-safe-graphic-targets';

const SOURCE_SHA256 = '98fe84604b01edc3224b52cdcb07c11a3c2916f99ce1a99c224f026ecbc64606';
const MULTI_VIEW_COMPARATOR_SHA256 = '76c8b1ceb22e427a43d2b6b39502316208dd34fec3b1786b3063640386852781';
const COM2_ID = 'fla-render-target-e5db7116dc714b4d5dd6d71a8a711899bfd1d9d28efb9a3974978657b2d885fe';
const COM12_ID = 'fla-render-target-43c0a17a5afe9d43579b7e14d0b40cc6b788defbb79afa6a2704c235c8c6324e';
const COM2_NAME = '修仙男-cilisucai.com1/修仙男-cilisucai.com2';
const COM12_NAME = '修仙男-cilisucai.com1/修仙男-cilisucai.com12';

describe('Issue #961 source-bound Character Graphic roots', () => {
  it.each([
    [COM2_NAME, COM2_ID],
    [COM12_NAME, COM12_ID],
  ])('admits only the proven frame-zero root %s', (libraryItemName, targetId) => {
    expect(isR05SafeGraphicCandidateId(targetId)).toBe(true);
    expect(isR05SafeGraphicSource(SOURCE_SHA256.toUpperCase(), libraryItemName, 0)).toBe(true);
  });

  it.each([
    ['修仙男-cilisucai.com1/修仙男-cilisucai.com20', SOURCE_SHA256, 0],
    [COM2_NAME, '0'.repeat(64), 0],
    [COM12_NAME, SOURCE_SHA256, 1],
    ['folder/unverified', SOURCE_SHA256, 0],
    ['folder/com2', SOURCE_SHA256, 0],
  ])('rejects unverified Graphic target %s', (libraryItemName, sourceSha256, frameIndex) => {
    expect(isR05SafeGraphicSource(sourceSha256, libraryItemName, frameIndex)).toBe(false);
  });

  it('does not admit arbitrary or unsupported render target IDs', () => {
    expect(isR05SafeGraphicCandidateId('fla-render-target-arbitrary0000')).toBe(false);
    expect(isR05SafeGraphicCandidateId('fla-render-target-c9dd05a67121cb1500b7ff28946b1aaefe374a04e242655ad818103dacaaabea')).toBe(false);
  });

  it('keeps the #09 multi-view comparator outside the R05 single-view Graphic fallback', () => {
    expect(isR05SafeGraphicSource(MULTI_VIEW_COMPARATOR_SHA256, COM2_NAME, 0)).toBe(false);
  });
});
