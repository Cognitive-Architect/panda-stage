import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AnimationImportIR, FlaInspectionResponse } from '../../src/shared/fla-import-api';
import type { FlaRenderableTargetCatalogEntry } from '../../src/shared/fla-static-snapshot-api';
import {
  boundedUnsupportedReason,
  FlaStageF1Notice,
  FlaStageF2UnavailableDetails,
  FlaStageF3Blocked,
  getFlaStageF1Warnings,
} from '../../src/renderer/fla-import/FlaStageF';

const compatibility: AnimationImportIR['compatibility'] = [
  { feature: 'basic-tweens', status: 'degraded', reason: 'not all tween details are preserved' },
  { feature: 'video', status: 'unsupported', reason: 'video is outside the current import range' },
  { feature: 'future-feature', status: 'unknown', reason: 'not classified' },
  { feature: 'bitmap-media', status: 'exact', reason: 'supported' },
  { feature: 'text', status: 'not-present', reason: 'not present' },
];

const unavailableEntry: FlaRenderableTargetCatalogEntry = {
  target: {
    renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b',
    kind: 'graphic-symbol',
    userLabel: '文本目标',
    frameCount: 2,
    compatibility: ['unsupported'],
  },
  previewSupported: false,
  unsupportedReason: 'shape tween not implemented',
};

const blockedResponse: FlaInspectionResponse = {
  ok: false,
  error: {
    code: 'MALFORMED_ARCHIVE',
    message: 'MALFORMED_ARCHIVE: EOCD mismatch',
  },
  diagnostics: [
    {
      category: 'archive-malformed',
      userMessage: '此 FLA 文件的结构未通过安全检查，Panda 已停止继续读取。',
    },
  ],
  trace: {
    ingestMode: 'strict',
    recoveryApplied: false,
    originalStrictResult: 'reject',
    classifierState: 'REJECT',
    recoveryAttempted: false,
    postNormalizationStrictResult: 'not-run',
    parserResult: 'not-run',
    originalSourceSha256: 'a'.repeat(64),
    originalSourceByteLength: 24,
    classifierReasonCodes: ['EOCD_INCONSISTENT'],
  },
};

describe('Issue #402 Stage F presentation contract', () => {
  it('treats degraded, unsupported, and unknown compatibility as F1 warnings while keeping not-present secondary', () => {
    expect(getFlaStageF1Warnings(compatibility).map((entry) => entry.status)).toEqual([
      'degraded',
      'unsupported',
      'unknown',
    ]);

    const html = renderToStaticMarkup(
      createElement(FlaStageF1Notice, { compatibility }),
    );
    expect(html).toContain('data-testid="fla-stage-f1-warning"');
    expect(html).toContain('部分内容可能与原 FLA 有差异');
    expect(html).toContain('查看 3 项说明');
    expect(html).toContain('data-testid="fla-stage-f1-details"');
    expect(html).toContain('fla-stage-f1-render-notice');
    expect(html).not.toContain('<span>当前流程仍可继续，详情按需查看。</span>');
    expect(html).not.toContain('>F1<');
    expect(html).not.toContain('>not-present<');
  });

  it('does not mount an F1 notice for clear or not-present-only compatibility', () => {
    const html = renderToStaticMarkup(
      createElement(FlaStageF1Notice, {
        compatibility: [
          { feature: 'text', status: 'not-present', reason: 'not present' },
          { feature: 'bitmap-media', status: 'exact', reason: 'supported' },
        ],
      }),
    );
    expect(html).toBe('');
  });

  it('keeps an F2 target visible, non-selectable, and separate from the render authority', () => {
    const html = renderToStaticMarkup(
      createElement(FlaStageF2UnavailableDetails, { entry: unavailableEntry }),
    );
    expect(html).toContain('data-preview-supported="false"');
    expect(html).toContain('暂不可预览');
    expect(html).toContain('文本目标');
    expect(html).toContain('其他可用目标不受影响');
    expect(html).toContain('矢量内容');
    expect(html).not.toContain('shape tween not implemented');
    expect(html).not.toContain('>F2<');
    expect(boundedUnsupportedReason('unknown producer detail')).toBe(
      'Panda 当前无法安全确认该目标的渲染结果。',
    );
  });

  it('uses a dedicated F3 blocked composition with one safe exit and no raw internals', () => {
    const html = renderToStaticMarkup(
      createElement(FlaStageF3Blocked, { response: blockedResponse, onClose: () => undefined }),
    );
    expect(html).toContain('data-testid="fla-stage-f3-blocked"');
    expect(html).toContain('这个 FLA 暂时无法安全处理');
    expect(html).toContain('原文件没有被修改');
    expect(html).toContain('data-testid="fla-stage-f3-return"');
    expect(html.match(/data-testid="fla-stage-f3-return"/gu)).toHaveLength(1);
    expect(html).not.toContain('MALFORMED_ARCHIVE');
    expect(html).not.toContain('EOCD');
    expect(html).not.toContain('data-testid="fla-snapshot-preview"');
    expect(html).not.toContain('data-testid="fla-frame-sequence-render"');
    expect(html).not.toContain('>F3<');
  });
});

describe('Issue #402 integration/source contracts', () => {
  const session = readFileSync('src/renderer/fla-import/FlaCompatibilityReviewSession.tsx', 'utf8');
  const route = readFileSync('src/renderer/fla-import/fla-content-route.ts', 'utf8');
  const snapshot = readFileSync('src/renderer/fla-import/FlaStaticSnapshotReview.tsx', 'utf8');
  const sequence = readFileSync('src/renderer/fla-import/FlaFrameSequenceReview.tsx', 'utf8');
  const builder = readFileSync('src/main/services/fla-static-snapshot-svg-builder.ts', 'utf8');
  const styles = readFileSync('src/renderer/styles.css', 'utf8');

  it('preserves routing and mounts F3 only on the existing failed inspection response', () => {
    expect(session).toContain('if (response && !response.ok)');
    expect(session).toContain('<FlaStageF3Blocked response={response} onClose={onClose} />');
    expect(session).toContain("contentRoute === 'v1-raster-review'");
    expect(route).toContain("'v2r-target-discovery'");
  });

  it('keeps F2 focus separate from R1/R2 target selection and uses the existing discovery boundary', () => {
    expect(snapshot).toContain('focusedTargetId');
    expect(snapshot).toContain('fla-snapshot-f2-focus-');
    expect(sequence).toContain('focusedTargetId');
    expect(sequence).toContain('fla-frame-sequence-f2-focus-');
    expect(builder).toContain('if (!found) continue;');
    expect(builder).toContain('entries.push({ target, previewSupported: true });');
  });

  it('keeps Stage F styling bounded without adding a dominant F1 Workbench row', () => {
    expect(styles).toContain('/* Issue #402 / #403 Problem 1: Stage F severity presentation.');
    expect(styles).toContain('.fla-stage-f2-unavailable-details');
    expect(styles).toContain('.fla-stage-f3-blocked');
    expect(styles).toContain('.fla-render-workbench-header > .fla-stage-f1-render-notice');
    expect(styles).not.toContain(".fla-render-workbench[data-stage-f1='true']");
    expect(styles).not.toContain(".fla-render-workbench[data-stage-f1='true'] {");
  });

  it('keeps the Raster overview shrink-safe for long source basenames', () => {
    expect(session).toContain('<h3 title={ir.source.basename}>{ir.source.basename}</h3>');
    expect(styles).toContain('.fla-raster-overview {\n  grid-template-columns: minmax(0, 1fr);');
    expect(styles).toContain('.fla-raster-overview > div > *');
    expect(styles).toContain('.fla-raster-overview .fla-review-compatibility > *');
  });
});
