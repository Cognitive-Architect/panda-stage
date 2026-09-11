import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatRecoveryTime } from '../../src/renderer/shell/RecoveryCandidateBanner';

function readSource(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

describe('Issue #485 recovery card contract', () => {
  it('uses a compact same-day time and a short localized date otherwise', () => {
    const now = new Date(2026, 8, 11, 7, 54, 12);

    expect(
      formatRecoveryTime(new Date(2026, 8, 11, 7, 54).getTime(), now),
    ).toBe('今天 07:54');
    expect(
      formatRecoveryTime(new Date(2026, 8, 10, 7, 54).getTime(), now),
    ).toMatch(/10.*07:54/u);
  });

  it('keeps the recovery actions, alert semantics, and progressive details affordance', () => {
    const banner = readSource('src/renderer/shell/RecoveryCandidateBanner.tsx');
    const styles = readSource('src/renderer/styles.css');

    expect(banner).toContain('发现可恢复内容');
    expect(banner).not.toContain('检测到未保存的恢复内容');
    expect(banner).toContain('role="alert"');
    expect(banner).toContain('onClick={() => void onRestore()}');
    expect(banner).toContain('onClick={() => void onIgnore()}');
    expect(banner).toContain('aria-label="查看恢复详情"');
    expect(banner).toContain('···');
    expect(banner).toContain('className="recovery-details-content"');
    expect(styles).toContain('width: fit-content;');
    expect(styles).toContain('max-width: min(560px, calc(100vw - 32px));');
    expect(styles).toContain(
      '.recovery-details[open] .recovery-details-content',
    );
  });
});
