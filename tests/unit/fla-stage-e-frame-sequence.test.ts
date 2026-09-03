import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sequence = readFileSync(
  'src/renderer/fla-import/FlaFrameSequenceReview.tsx',
  'utf8',
);
const styles = readFileSync('src/renderer/styles.css', 'utf8');
const verifier = readFileSync('scripts/verify-issue399-stage-e.cjs', 'utf8');

describe('Issue #399 Stage E frame-sequence workbench contract', () => {
  it('keeps sequence review in one three-zone task surface', () => {
    for (const testId of [
      'fla-frame-sequence-workbench',
      'fla-frame-sequence-target-region',
      'fla-frame-sequence-target-search',
      'fla-frame-sequence-targets',
      'fla-frame-sequence-preview-region',
      'fla-frame-sequence-preview-image',
      'fla-frame-sequence-range',
      'fla-frame-sequence-filmstrip',
      'fla-frame-sequence-details-region',
      'fla-frame-sequence-action-bar',
    ]) {
      expect(sequence).toContain(`data-testid="${testId}"`);
    }
    expect(sequence).toContain('selectedPreviewIndex');
    expect(sequence).toContain('setSelectedPreviewIndex(index)');
    expect(sequence).not.toContain('previewUrls.map((url, index) =>');
    expect(sequence).not.toContain('<fieldset className="fla-frame-sequence-range"');
  });

  it('preserves local range validation and state-driven R2 boundaries', () => {
    expect(sequence).toContain('validateRange(startFrameIndex, endFrameIndex, targetFrameCount)');
    expect(sequence).toContain('buildRange(renderTargetId, startFrameIndex, endFrameIndex)');
    expect(sequence).toContain('getDefaultSequenceRange(firstSupported.target.frameCount)');
    expect(sequence).toContain('getDefaultSequenceRange(entryTarget.frameCount)');
    expect(sequence).toContain('intentChangeReset');
    expect(sequence).toContain('rerenderReset');
    expect(sequence).toContain('isCurrentResponse(activeRequestIdRef.current, response)');
    expect(sequence).toContain('flaFrameSequenceClient.progressSubscribe');
    expect(sequence).toContain('confirmedSequenceRequestId: success.requestId');
    expect(sequence).toContain('setStartFrameIndex(Math.trunc(value))');
    expect(sequence).toContain('setEndFrameIndex(Math.trunc(value))');
  });

  it('bounds target and filmstrip scrolling while keeping the footer visible', () => {
    expect(styles).toContain('/* Issue #399: Stage E uses the same bounded Workbench composition as Stage D.');
    expect(styles).toMatch(
      /\.fla-frame-sequence-workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(210px, 0\.86fr\) minmax\(360px, 1\.7fr\) minmax\(210px, 0\.84fr\);/u,
    );
    expect(styles).toMatch(
      /\.fla-frame-sequence-targets\s*\{[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.fla-frame-sequence-filmstrip\s*\{[\s\S]*?overflow-x:\s*auto;/u,
    );
    expect(styles).toMatch(
      /\.fla-frame-sequence-action-bar\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*2;/u,
    );
  });

  it('separates automated and maintainer acceptance receipts', () => {
    expect(verifier).toContain("args.manual = true");
    expect(verifier).toContain("acceptanceKind: 'maintainer-manual-acceptance'");
    expect(verifier).toContain("kind: args.manual ? 'maintainer-manual-acceptance' : 'automated-synthetic-verifier'");
    expect(verifier).toContain('dedicatedUserData: Boolean(args.userData)');
    expect(verifier).toContain('if (startupArgs.keepOpen) return;');
  });
});
