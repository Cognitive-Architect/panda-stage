import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

type BoundaryState = {
  braceDepth: number;
  parenDepth: number;
  bracketDepth: number;
  inComment: boolean;
  quote: string | null;
  topLevelStatementPending: boolean;
};

const { isCompleteBoundary, scanCss } = require('../../scripts/css-split-boundary.cjs') as {
  isCompleteBoundary: (state: BoundaryState | undefined) => boolean;
  scanCss: (value: string) => {
    states: BoundaryState[];
    errors: string[];
  };
};

describe('CSS split complete-rule boundary preflight', () => {
  it('rejects a zero-depth boundary inside a multiline selector list', () => {
    const scan = scanCss(`.first,
.second {
  color: red;
}
`);

    expect(scan.errors).toEqual([]);
    expect(scan.states[1]).toMatchObject({
      braceDepth: 0,
      parenDepth: 0,
      bracketDepth: 0,
      topLevelStatementPending: true,
    });
    expect(isCompleteBoundary(scan.states[1])).toBe(false);
    expect(isCompleteBoundary(scan.states[4])).toBe(true);
  });

  it('keeps a completed top-level at-rule boundary valid after its block closes', () => {
    const scan = scanCss(`@media (min-width: 1px) {
  .first { color: red; }
}
`);

    expect(scan.errors).toEqual([]);
    expect(isCompleteBoundary(scan.states[1])).toBe(false);
    expect(isCompleteBoundary(scan.states[3])).toBe(true);
  });
});
