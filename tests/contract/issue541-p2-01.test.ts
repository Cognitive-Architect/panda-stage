import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readOrderedStylesheetSource } from '../helpers/read-stylesheet-source';

const root = resolve(process.cwd());
const manifest = JSON.parse(
  readFileSync(resolve(root, 'scripts', 'css-split-manifest.json'), 'utf8'),
) as {
  baseline: { commit: string; sourcePath: string };
  phase2CanonicalMap: { path: string; sha256: string; approvedForAutomaticRelocation: boolean };
  rootEntry: { path: string };
  semanticRelocations: Array<{
    id: string;
    segment: string;
    sectionIds: string[];
    sourceSlice: string;
    owner: string;
    migrationMode: string;
    canonicalOrder: number;
    predecessor: string;
    successor: string;
    sourceRange: { startLine: number; endLine: number };
    targetPath: string;
    insertBefore?: string;
    sourceSha256: string;
  }>;
};

const preflight = JSON.parse(
  readFileSync(resolve(root, 'docs', 'evidence', 'issue-541-p2-01', 'preflight.json'), 'utf8'),
) as {
  sourceSlice: string;
  section: string;
  segment: string;
};

const ledger = JSON.parse(
  readFileSync(resolve(root, 'docs', 'evidence', 'issue-541-p2-01', 'ledger.json'), 'utf8'),
) as {
  canonicalSection: string;
  segment: string;
  livePrHeadAuthority: string;
  selfReferenceRule: string;
  legacyReceiptFieldSemantics: Record<string, string>;
};

const rollingLedger = JSON.parse(
  readFileSync(
    resolve(root, 'docs', 'evidence', 'issue-541-p2-01', 'phase2-rolling-ledger.json'),
    'utf8',
  ),
) as {
  pullRequest: number;
  livePrHeadAuthority: string;
  livePrCiAuthority: string;
  selfReferenceRule: string;
  humanAcceptanceSemantics: string;
  batches: Record<
    string,
    {
      preflightBaseHead: string;
      integrationParentHead: string;
      implementationHead: string;
      directImplementationCi?: string;
      implementationCi?: { automaticCiRun: number; automaticCiResult: string };
      validatedRollingSnapshotBeforeThisFix: {
        head: string;
        automaticCiRun: number;
        automaticCiResult: string;
      };
      humanAcceptance: {
        status: string;
        acceptedOn: string;
        acceptedBy: string;
        scope: string;
      };
      legacyReceiptSemantics: Record<string, string>;
    }
  >;
};

const phase2CanonicalMap = readFileSync(resolve(root, manifest.phase2CanonicalMap.path), 'utf8');

function normalize(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sourceLines(value: string): string[] {
  const lines = normalize(value).split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function importPaths(): string[] {
  return sourceLines(readFileSync(resolve(root, manifest.rootEntry.path), 'utf8'))
    .map((line) => /^\s*@import\s+['"]([^'"]+)['"]\s*;\s*$/u.exec(line)?.[1] ?? null)
    .filter((path): path is string => path !== null);
}

function markdownCells(line: string): string[] {
  if (!line.trim().startsWith('|')) return [];
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim().replaceAll('`', '').replaceAll('**', ''));
}

const authorizedCanonicalTargetOverrides = new Map<string, string>([
  [
    'G097',
    'src/renderer/styles/shell/tools/s11-01--view-mode-pilot.css',
  ],
]);

describe('Issue #541 P2-01 semantic stylesheet continuation', () => {
  it('records the approved S11-01 boundary and ownership chain', () => {
    const relocation = manifest.semanticRelocations.find(({ id }) => id === 'S11-01');
    expect(relocation).toBeDefined();
    expect(relocation).toMatchObject({
      id: 'S11-01',
      sourceSlice: 'S11',
      owner: 'shell-tools',
      migrationMode: 'DIRECT+VERIFICATION',
      canonicalOrder: 112,
      predecessor: 'S10-08/G096',
      successor: 'S11-02/G098',
      sourceRange: { startLine: 21803, endLine: 21856 },
      targetPath: 'src/renderer/styles/shell/tools/view-mode.css',
      insertBefore: 'src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css',
    });
  });

  it('keeps Section and Segment identities distinct in the evidence ledger', () => {
    expect(preflight).toMatchObject({
      sourceSlice: 'S11',
      section: 'S11-01',
      segment: 'G097',
    });
    expect(ledger).toMatchObject({
      canonicalSection: 'S11-01',
      segment: 'G097',
      livePrHeadAuthority: 'GitHub PR #542 metadata',
    });
    expect(ledger.selfReferenceRule).toContain('Do not store the current/final PR HEAD');
    expect(ledger.legacyReceiptFieldSemantics['receipt.json.finalHead']).toContain('DEPRECATED NAME');
  });

  it('keeps rolling-batch preflight, integration, implementation, live-head, and human-acceptance semantics distinct', () => {
    expect(rollingLedger).toMatchObject({
      pullRequest: 542,
      livePrHeadAuthority: 'GitHub PR #542 metadata',
      livePrCiAuthority: 'Latest GitHub Actions run attached to the current PR head',
    });
    expect(rollingLedger.selfReferenceRule).toContain('Do not embed the current/final PR HEAD');
    expect(rollingLedger.humanAcceptanceSemantics).toContain('separately from automated');
    expect(rollingLedger.batches['P2-B06']).toMatchObject({
      preflightBaseHead: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      integrationParentHead: 'f5d25ef8adddbe88d42dcab2cc2212b4c0203590',
      implementationHead: '51516f27b44d4b0c6b7923643aec75272190552b',
      directImplementationCi: 'NO_DIRECT_PR_RUN_FOUND',
      validatedRollingSnapshotBeforeThisFix: {
        head: 'f3918a9b8bd20a8b888846f47eacd948c6f98dee',
        automaticCiRun: 35078292960,
        automaticCiResult: 'PASS',
      },
      humanAcceptance: {
        status: 'PASS',
        acceptedOn: '2026-09-16',
        acceptedBy: 'maintainer',
      },
    });
    expect(rollingLedger.batches['P2-B01']).toMatchObject({
      preflightBaseHead: '02cddd3d2bb0fadd55926c57a99f021822a18b80',
      integrationParentHead: '51516f27b44d4b0c6b7923643aec75272190552b',
      implementationHead: 'e6adbdae2a3c7d7abd6f3973c66c708e2c6a004e',
      implementationCi: {
        automaticCiRun: 35077222980,
        automaticCiResult: 'PASS',
      },
      validatedRollingSnapshotBeforeThisFix: {
        head: 'f3918a9b8bd20a8b888846f47eacd948c6f98dee',
        automaticCiRun: 35078292960,
        automaticCiResult: 'PASS',
      },
      humanAcceptance: {
        status: 'PASS',
        acceptedOn: '2026-09-16',
        acceptedBy: 'maintainer',
      },
    });
  });

  it('aligns every registered Phase 2 relocation with the canonical Section/Segment registry', () => {
    expect(manifest.phase2CanonicalMap.approvedForAutomaticRelocation).toBe(false);
    expect(sha256(normalize(phase2CanonicalMap))).toBe(manifest.phase2CanonicalMap.sha256);

    const rows = sourceLines(phase2CanonicalMap).map(markdownCells);
    const sectionRows = new Map(
      rows
        .filter(
          (cells) => /^\d+$/u.test(cells[0] ?? '') && /^S\d{2}-\d{2}$/u.test(cells[1] ?? ''),
        )
        .map((cells) => [cells[1]!, cells] as const),
    );
    const segmentRows = new Map(
      rows
        .filter((cells) => /^G\d{3}$/u.test(cells[0] ?? '') && cells.length >= 5)
        .map((cells) => [cells[0]!, cells] as const),
    );

    for (const relocation of manifest.semanticRelocations) {
      const segmentRow = segmentRows.get(relocation.segment);
      expect(segmentRow, `${relocation.id} missing canonical Segment ${relocation.segment}`).toBeDefined();
      expect(segmentRow?.[1]).toBe(relocation.owner);
      for (const sectionId of relocation.sectionIds) {
        expect(segmentRow?.[3]).toContain(sectionId);
        const sectionRow = sectionRows.get(sectionId);
        expect(sectionRow, `${relocation.id} missing canonical Section ${sectionId}`).toBeDefined();
        expect(sectionRow?.[2]).toBe(relocation.owner);
        expect(sectionRow?.[7]).toBe(relocation.segment);
      }

      const canonicalTarget = authorizedCanonicalTargetOverrides.get(relocation.segment)
        ?? relocation.targetPath;
      expect(segmentRow?.[4]).toBe(canonicalTarget);
    }

    expect(
      manifest.semanticRelocations.find(({ segment }) => segment === 'G097')?.targetPath,
    ).toBe('src/renderer/styles/shell/tools/view-mode.css');
  });

  it('loads the semantic segment once at the original production position', () => {
    const imports = importPaths();
    const semanticIndex = imports.indexOf('./styles/shell/tools/view-mode.css');
    const s11RemainderStartIndex = imports.indexOf(
      './styles/legacy-slices/11-tools-inspector-timeline-start--before-landscape-layer-controls.css',
    );
    const layerPropertiesIndex = imports.indexOf(
      './styles/features/properties/s11-05--landscape-layer-controls.css',
    );
    const legacyIndex = imports.indexOf('./styles/legacy-slices/11-tools-inspector-timeline-start.css');
    expect(semanticIndex).toBeGreaterThan(-1);
    expect(s11RemainderStartIndex).toBe(semanticIndex + 1);
    expect(layerPropertiesIndex).toBe(s11RemainderStartIndex + 1);
    expect(legacyIndex).toBe(layerPropertiesIndex + 1);
    expect(imports.filter((path) => path === './styles/shell/tools/view-mode.css')).toHaveLength(1);
  });

  it('reconstructs the pinned source through the real production entry', () => {
    expect(sha256(readOrderedStylesheetSource())).toBe(
      '2404124609c88ee552288a51ffa3f5408cd2193adc754235af234cdd922ba3e7',
    );
  });

  it('keeps the moved bytes exact and leaves the action-preset section in the legacy remainder', () => {
    const relocation = manifest.semanticRelocations.find(({ id }) => id === 'S11-01')!;
    const target = normalize(readFileSync(resolve(root, relocation.targetPath), 'utf8'));
    const legacy = normalize(
      readFileSync(
        resolve(root, 'src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start.css'),
        'utf8',
      ),
    );
    const actionPresetRemainder = normalize(
      readFileSync(
        resolve(
          root,
          'src/renderer/styles/legacy-slices/11-tools-inspector-timeline-start--before-landscape-layer-controls.css',
        ),
        'utf8',
      ),
    );
    expect(sha256(target)).toBe(relocation.sourceSha256);
    expect(legacy).not.toContain('.project-tools-view-mode-card');
    expect(actionPresetRemainder.startsWith('.project-tools-action-presets-view {')).toBe(true);
  });
});
