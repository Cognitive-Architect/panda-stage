import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const notice = readFileSync(path.join(root, 'resources/licenses/FLA-PARSER-NOTICE.txt'), 'utf8');
const policy = readFileSync(path.join(root, 'docs/handoff/issue-260-fla-parser-policy.md'), 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};
const electronBuilder = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

describe('Issue #260 Slice 4 adoption boundary', () => {
  it('keeps the bounded parser provenance, notice, and update policy durable', () => {
    expect(notice).toContain('048000ccab67469980b8dedd1fc2b65a02d2b164');
    expect(notice).toContain('LICENSE_INTENT_ONLY');
    expect(notice).toContain('https://github.com/Cognitive-Architect/panda-stage/issues/250');
    expect(notice).toContain('jszip@3.10.1');
    expect(notice).toContain('pako@1.0.11');
    expect(notice).toContain('Zlib License');
    expect(policy).toContain('updates are explicit and reviewable');
    expect(policy).toContain('real-sample compatibility verifier');
    expect(policy).toMatch(/No floating\s+upstream URL/u);
  });

  it('keeps the parser closure and built packaging route bounded', () => {
    const parserCore = path.join(root, 'src/renderer/fla-import/parser-core');
    const files = readdirSync(parserCore).sort();
    expect(files).toEqual([
      'adpcm-decoder.ts',
      'binary-fla-parser.ts',
      'binary-fla-structure.ts',
      'binary-instance-decoder.ts',
      'binary-shape-decoder.ts',
      'binary-timeline-decoder.ts',
      'edge-decoder.ts',
      'fla-parser.ts',
      'flv-parser.ts',
      'ole2-reader.ts',
      'path-utils.ts',
      'types.ts',
    ]);
    expect(packageJson.dependencies.jszip).toBe('3.10.1');
    expect(packageJson.dependencies.pako).toBe('1.0.11');
    expect(packageJson.scripts['verify:issue260-slice4']).toBe(
      'pnpm build && electron scripts/verify-issue260-slice4.cjs',
    );
    expect(electronBuilder).toContain('from: resources/licenses');
    expect(electronBuilder).toContain('to: licenses');
  });
});
