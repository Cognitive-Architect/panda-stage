import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import { migrateProject } from '../../src/domain';
import { AssetDetails } from '../../src/renderer/features/assets/AssetDetails';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

const noop = () => undefined;

describe('Issue #344 portrait Assets density and reachability', () => {
  it('keeps the selected inspector before the normal asset grid', () => {
    const library = source(
      'src/renderer/features/assets/AssetLibrary.tsx',
    );
    const inspectorIndex = library.indexOf(
      'className="asset-selected-inspector"',
    );
    const gridIndex = library.indexOf('<AssetGrid');

    expect(inspectorIndex).toBeGreaterThanOrEqual(0);
    expect(gridIndex).toBeGreaterThan(inspectorIndex);
    expect(library).toContain('aria-expanded={selectedDetailsOpen}');
    expect(library).toContain('aria-controls={`asset-selected-details-');
    expect(library).toContain('presentation="portrait"');
  });

  it('uses a denser two-column card treatment and an aligned action row', () => {
    const styles = source('src/renderer/styles.css');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');

    expect(styles).toContain('aspect-ratio: 16 / 10;');
    expect(styles).toContain('.asset-card-context {\n  display: none;');
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain('.resource-activity-fla-action');
    expect(styles).toContain('grid-column: 2;\n  grid-row: 2;');
    expect(dock).toContain('data-testid="resource-asset-import-fla"');
  });

  it('exposes a compact portrait AssetDetails presentation without changing data', () => {
    const project = migrateProject(exampleProject);
    const asset = project.assets.find((candidate) => candidate.kind === 'image')!;
    const markup = renderToStaticMarkup(
      createElement(AssetDetails, {
        asset,
        busy: false,
        onDelete: noop,
        presentation: 'portrait',
        references: [],
      }),
    );

    expect(markup).toContain('asset-details-portrait');
    expect(markup).toContain(asset.name);
    expect(markup).toContain(asset.relativePath);
    expect(markup).toContain('asset-delete-button');
  });
});
